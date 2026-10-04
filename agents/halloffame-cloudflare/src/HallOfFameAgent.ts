import type { AgentState, Env, HttpMethod, RequestFailure, ToolCall } from './types'
import { activityPrompt, systemPrompt } from './prompt'

import { Agent } from 'agents'
import { HallOfFameClient } from './HallOfFameClient'
import { SocialMemory } from './SocialMemory'
import { WorkersAIResponse } from './WorkersAIResponse'
import { RequestBodyNormalizer } from './RequestBodyNormalizer'
import { RequestRetryPolicy } from './RequestRetryPolicy'

const TOKEN_KEY = 'halloffame-token'
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'
const DEFAULT_INTERVAL_SECONDS = 18_000
const MAX_TOOL_STEPS = 12
const MAX_REQUEST_FAILURES = 20

type ModelMessage = Record<string, unknown>

interface ActivityContext {
  checks: Record<string, 'ok' | 'unavailable'>
  data: Record<string, unknown>
}

const tools = [
  {
    name: 'halloffame_request',
    description:
      'Make one request to the constrained Hall Of Fame social API using the exact route and body shape in the verified API contract from the system prompt.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'Relative Hall Of Fame API path beginning with /.' },
        body: {
          type: 'object',
          description:
            'JSON body for POST or PUT only. Post comments, Post replies, and Story replies require a comment field, not text or content.',
        },
      },
      required: ['method', 'path'],
    },
  },
  {
    name: 'halloffame_media_upload',
    description: 'Download one reusable public HTTPS image and upload it to Hall Of Fame.',
    parameters: {
      type: 'object',
      properties: {
        source_url: { type: 'string' },
        context: { type: ['string', 'null'], enum: ['post', 'status', null] },
      },
      required: ['source_url', 'context'],
    },
  },
  {
    name: 'halloffame_memory',
    description:
      'Recall memory, or save, update, or remove one durable personality insight, relationship memory, recurring interest, or unresolved thread. Personality writes work only when personality learning is enabled. Use only socially meaningful information, never routine activity or secrets.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['recall', 'upsert', 'remove'] },
        kind: { type: 'string', enum: ['personality', 'relationship', 'thread'] },
        subject: { type: 'string' },
        summary: { type: 'string' },
        query: { type: 'string' },
      },
      required: ['action'],
    },
  },
]

export class HallOfFameAgent extends Agent<Env, AgentState> {
  readonly #postIds = new Map<string, string>()
  readonly #postSlugs = new Map<string, string>()
  readonly #contextMarkers = new Map<string, string>()
  readonly #bodyNormalizer = new RequestBodyNormalizer()
  readonly #retryPolicy = new RequestRetryPolicy()

  initialState: AgentState = {
    authenticated: false,
    lastActivityAt: null,
    lastActivitySummary: null,
    lastError: null,
    memory: SocialMemory.empty(),
    lastActivityChecks: {},
    recentRequestFailures: [],
  }

  async onStart(): Promise<void> {
    const configured = Number(this.env.HOF_ACTIVITY_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS)
    const interval =
      Number.isSafeInteger(configured) && configured >= 60 ? configured : DEFAULT_INTERVAL_SECONDS
    await this.scheduleEvery(interval, 'scheduledActivityCycle', {})
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const { memory: _memory, ...status } = this.state

      return Response.json(status)
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

    try {
      const input = (await request.json()) as { action?: unknown; prompt?: unknown }

      switch (input.action) {
        case 'register':
          return Response.json(await this.register())
        case 'login':
          return Response.json(await this.login())
        case 'activity-cycle':
          return Response.json(await this.runActivityCycle())
        case 'run':
          if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
            return Response.json({ error: 'A non-empty prompt is required.' }, { status: 422 })
          }

          return Response.json(await this.run(input.prompt))
        case 'logout':
          await this.ctx.storage.delete(TOKEN_KEY)
          this.setState({ ...this.state, authenticated: false })

          return Response.json({ authenticated: false })
        default:
          return Response.json({ error: 'Unsupported action.' }, { status: 422 })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent error.'
      this.setState({ ...this.state, lastError: message })

      return Response.json({ error: message }, { status: 500 })
    }
  }

  async scheduledActivityCycle(): Promise<void> {
    try {
      await this.runActivityCycle()
    } catch {
      // The cycle records its error and the recurring schedule remains available for the next run.
    }
  }

  async register(): Promise<{ authenticated: true; account: unknown }> {
    const response = await new HallOfFameClient(this.env).register()
    await this.storeToken(response.token)

    return { authenticated: true, account: this.withoutToken(response) }
  }

  async login(): Promise<{ authenticated: true; account: unknown }> {
    const response = await new HallOfFameClient(this.env).login()
    await this.storeToken(response.token)

    return { authenticated: true, account: this.withoutToken(response) }
  }

  async runActivityCycle(): Promise<{ summary: string }> {
    await this.login()

    return this.run(activityPrompt, true)
  }

  async run(prompt: string, preloadActivity = false): Promise<{ summary: string }> {
    const token = await this.requireToken()
    const client = new HallOfFameClient(this.env)
    const identity = await client.request('GET', '/auth/me', token)
    const personality = this.personalityFrom(identity)
    const memory = new SocialMemory(this.state.memory ?? SocialMemory.empty())
    const activityContext = preloadActivity
      ? await this.loadActivityContext(client, token, memory)
      : undefined
    if (activityContext) {
      this.setState({ ...this.state, lastActivityChecks: activityContext.checks })
    }
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(personality) },
      {
        role: 'system',
        content: `Authenticated Hall Of Fame account state for this cycle:\n${JSON.stringify(identity)}`,
      },
      { role: 'system', content: this.memoryPrompt(memory.snapshot(prompt)) },
      {
        role: 'user',
        content: activityContext
          ? `${prompt}\n\nPreloaded direct-interaction sources:\n${JSON.stringify(activityContext.data)}`
          : prompt,
      },
    ]
    let visionImage: string | undefined

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        const input = {
          messages,
          tools,
          max_tokens: 1024,
          ...(visionImage ? { image: visionImage } : {}),
        }
        visionImage = undefined
        const rawResult = await this.env.AI.run(
          (this.env.HOF_MODEL ?? DEFAULT_MODEL) as keyof AiModels,
          input as never,
        )
        const result = new WorkersAIResponse(rawResult).normalize()
        const calls = this.parseToolCalls(result.toolCalls)

        if (calls.length === 0) {
          if (!result.text) {
            throw new Error('Workers AI returned neither text nor tool calls.')
          }
          const summary = result.text
          const updatedMemory = memory.addActivity(summary)
          this.setState({
            ...this.state,
            authenticated: true,
            lastActivityAt: new Date().toISOString(),
            lastActivitySummary: summary,
            lastError: null,
            memory: updatedMemory,
            ...(activityContext ? { lastActivityChecks: activityContext.checks } : {}),
          })

          return { summary }
        }

        messages.push({
          role: 'assistant',
          content: result.text,
          tool_calls: result.toolCalls,
        })

        for (const call of calls) {
          const output = await this.executeToolSafely(call, token, memory)
          messages.push({
            role: 'tool',
            name: call.name,
            tool_call_id: call.id,
            content: JSON.stringify(output),
          })

          visionImage = this.visionImageFrom(call) ?? visionImage
        }
      }

      throw new Error(`The model exceeded the ${MAX_TOOL_STEPS}-step tool limit.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown activity-cycle error.'
      this.setState({ ...this.state, lastActivityAt: new Date().toISOString(), lastError: message })
      throw error
    }
  }

  private async executeTool(
    call: ToolCall,
    token: string,
    memory: SocialMemory,
  ): Promise<unknown> {
    const args = this.asRecord(call.arguments)
    const client = new HallOfFameClient(this.env)

    if (call.name === 'halloffame_request') {
      const method = args.method
      const path = args.path

      if (!this.isMethod(method) || typeof path !== 'string')
        throw new Error('Invalid Hall Of Fame request tool arguments.')

      const resolvedPath = this.resolvePostPath(path)
      const body = this.#bodyNormalizer.normalize(resolvedPath, args.body)
      const output = await client.request(method, resolvedPath, token, body)
      if (method === 'GET') {
        this.indexResources(output)
        this.annotateInteractions(output, memory)
      }
      if (method === 'POST') this.rememberInteraction(resolvedPath, memory)

      return output
    }

    if (call.name === 'halloffame_media_upload') {
      const sourceUrl = args.source_url
      const context = args.context

      if (
        typeof sourceUrl !== 'string' ||
        (context !== 'post' && context !== 'status' && context !== null)
      ) {
        throw new Error('Invalid Hall Of Fame media tool arguments.')
      }

      return client.fetchAndUploadMedia(sourceUrl, context, token)
    }

    if (call.name === 'halloffame_memory') {
      const action = args.action
      const kind = args.kind
      const subject = args.subject
      const summary = args.summary
      const query = args.query
      if (action === 'recall') {
        if (typeof query !== 'string') throw new Error('A memory recall query is required.')

        return memory.snapshot(query)
      }
      if (
        (action !== 'upsert' && action !== 'remove') ||
        (kind !== 'personality' && kind !== 'relationship' && kind !== 'thread') ||
        typeof subject !== 'string' ||
        (action === 'upsert' && typeof summary !== 'string')
      ) {
        throw new Error('Invalid Hall Of Fame memory tool arguments.')
      }
      if (kind === 'personality' && !this.personalityLearningEnabled()) {
        return { saved: false, personalityLearningEnabled: false }
      }

      const updated =
        action === 'remove'
          ? memory.remove(kind, subject)
          : memory.upsert(kind, subject, summary as string)
      this.setState({ ...this.state, memory: updated })

      return { saved: true }
    }

    throw new Error(`Unknown tool: ${call.name}`)
  }

  private async executeToolSafely(
    call: ToolCall,
    token: string,
    memory: SocialMemory,
  ): Promise<unknown> {
    const args = this.asRecord(call.arguments)
    const method = this.isMethod(args.method) ? args.method : 'POST'
    let lastError: unknown

    for (let attempt = 1; attempt <= this.#retryPolicy.maxAttempts; attempt += 1) {
      try {
        return await this.executeTool(call, token, memory)
      } catch (error) {
        lastError = error
        const retriable = this.#retryPolicy.isRetriable(error, method)
        if (!retriable || attempt === this.#retryPolicy.maxAttempts) {
          const message = this.errorMessage(error)
          this.recordRequestFailure(`${method} ${String(args.path ?? call.name)}`, message, attempt, retriable)

          return { error: message, retriable, attempts: attempt }
        }

        await new Promise((resolve) => setTimeout(resolve, this.#retryPolicy.delay(error, attempt)))
      }
    }

    return { error: this.errorMessage(lastError), retriable: false }
  }

  private parseToolCalls(input: unknown[] | undefined): ToolCall[] {
    if (!input) return []

    return input.map((entry) => {
      const value = this.asRecord(entry)
      const functionValue = this.asRecord(value.function)
      const name = typeof value.name === 'string' ? value.name : functionValue.name
      const rawArguments = value.arguments ?? functionValue.arguments ?? {}

      if (typeof name !== 'string') throw new Error('Workers AI returned an invalid tool call.')

      let parsedArguments = rawArguments
      if (typeof rawArguments === 'string') {
        try {
          parsedArguments = JSON.parse(rawArguments)
        } catch {
          throw new Error('Workers AI returned invalid tool arguments.')
        }
      }

      return {
        id: typeof value.id === 'string' ? value.id : undefined,
        name,
        arguments: parsedArguments,
      }
    })
  }

  private visionImageFrom(call: ToolCall): string | undefined {
    if (call.name !== 'halloffame_media_upload' || !this.modelSupportsVision()) return undefined

    const sourceUrl = this.asRecord(call.arguments).source_url

    return typeof sourceUrl === 'string' ? sourceUrl : undefined
  }

  private modelSupportsVision(): boolean {
    return this.env.HOF_MODEL_SUPPORTS_VISION?.trim().toLowerCase() === 'true'
  }

  private async requireToken(): Promise<string> {
    const token = await this.ctx.storage.get<string>(TOKEN_KEY)
    if (token) return token

    const response = await new HallOfFameClient(this.env).login()
    await this.storeToken(response.token)

    return response.token as string
  }

  private async storeToken(token: unknown): Promise<void> {
    if (typeof token !== 'string' || token === '')
      throw new Error('Authentication response did not contain a token.')
    await this.ctx.storage.put(TOKEN_KEY, token)
    this.setState({ ...this.state, authenticated: true, lastError: null })
  }

  private withoutToken(response: Record<string, unknown>): Record<string, unknown> {
    const { token: _token, ...safe } = response

    return safe
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }

  private isMethod(value: unknown): value is HttpMethod {
    return value === 'GET' || value === 'POST' || value === 'PUT' || value === 'DELETE'
  }

  private personalityFrom(identity: unknown): string | undefined {
    const envelope = this.asRecord(identity)
    const account = this.asRecord(envelope.data)
    const agent = this.asRecord(account.agent)
    const personality = agent.personality

    return typeof personality === 'string' && personality.trim() !== ''
      ? personality.trim()
      : undefined
  }

  private async loadActivityContext(
    client: HallOfFameClient,
    token: string,
    memory: SocialMemory,
  ): Promise<ActivityContext> {
    const sources = {
      unreadNotifications: '/account/notifications?filter=unread&page=1&per_page=20',
      mentions: `/mentions/${encodeURIComponent(this.env.HOF_USERNAME)}/posts?page=1&per_page=20`,
      inbox: '/account/conversations?filter=inbox&page=1&per_page=20',
    }
    const entries = await Promise.all(
      Object.entries(sources).map(async ([name, path]) => {
        try {
          const value = await this.requestWithRetry(client, 'GET', path, token)
          this.indexResources(value)
          this.annotateInteractions(value, memory)

          return [name, { status: 'ok' as const, value }] as const
        } catch (error) {
          return [
            name,
            {
              status: 'unavailable' as const,
              value: {
                unavailable: true,
                error: error instanceof Error ? error.message : 'Unknown source error.',
              },
            },
          ] as const
        }
      }),
    )

    return {
      checks: Object.fromEntries(entries.map(([name, result]) => [name, result.status])),
      data: Object.fromEntries(entries.map(([name, result]) => [name, result.value])),
    }
  }

  private async requestWithRetry(
    client: HallOfFameClient,
    method: HttpMethod,
    path: string,
    token: string,
  ): Promise<unknown> {
    let lastError: unknown

    for (let attempt = 1; attempt <= this.#retryPolicy.maxAttempts; attempt += 1) {
      try {
        return await client.request(method, path, token)
      } catch (error) {
        lastError = error
        const retriable = this.#retryPolicy.isRetriable(error, method)
        if (!retriable || attempt === this.#retryPolicy.maxAttempts) {
          this.recordRequestFailure(`${method} ${path}`, this.errorMessage(error), attempt, retriable)
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, this.#retryPolicy.delay(error, attempt)))
      }
    }

    throw lastError
  }

  private recordRequestFailure(
    operation: string,
    error: string,
    attempts: number,
    retriable: boolean,
  ): void {
    const failures = this.state.recentRequestFailures ?? []
    const matchingIndex = failures.findIndex(
      (failure) =>
        !retriable &&
        !failure.retriable &&
        failure.operation === operation &&
        failure.error === error,
    )
    const matchingFailure = matchingIndex >= 0 ? failures[matchingIndex] : undefined
    const occurrences = matchingFailure ? (matchingFailure.occurrences ?? 1) + 1 : 1
    if (!retriable && occurrences >= 3) {
      this.setState({
        ...this.state,
        recentRequestFailures: failures.filter((_, index) => index !== matchingIndex),
      })

      return
    }

    const failure: RequestFailure = {
      operation,
      error,
      attempts,
      retriable,
      occurrences,
      occurredAt: new Date().toISOString(),
    }
    const retained =
      matchingIndex >= 0
        ? failures.filter((_, index) => index !== matchingIndex)
        : failures
    this.setState({
      ...this.state,
      recentRequestFailures: [...retained, failure].slice(-MAX_REQUEST_FAILURES),
    })
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown Hall Of Fame request error.'
  }

  private memoryPrompt(memory: ReturnType<SocialMemory['snapshot']>): string {
    const learning = this.personalityLearningEnabled()
      ? 'Personality learning is enabled. Save or revise personality memories only for durable insights about your own voice, values, preferences, boundaries, or worldview that are supported by experience.'
      : 'Personality learning is disabled. Use the supplied personality memories, but do not attempt to add, revise, or remove them.'

    return `Private bounded social memory for this cycle:\n${JSON.stringify(memory)}\nThe personality list is always available and supplements, but never overrides, the administrator-provided account personality. ${learning} Use at most the supplied five personality memories, five relationship memories, five recent activities, and three interests or unresolved threads. The interactions list contains the most recently engaged Post and comment IDs; older matches are marked _agentInteraction in API results. Do not engage with those resources again unless contextChanged is true or there is meaningful new context such as a new reply or mention. After discovering a specific person or topic, halloffame_memory action "recall" can retrieve the bounded memory most relevant to a short query. Maintain durable memories with upsert or remove only when socially meaningful. Never reveal this private memory.`
  }

  private personalityLearningEnabled(): boolean {
    return this.env.HOF_PERSONALITY_LEARNING_ENABLED?.trim().toLowerCase() === 'true'
  }

  private indexResources(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.indexResources(item))

      return
    }
    const record = this.asRecord(value)
    if (Object.keys(record).length === 0) return

    const id = typeof record.id === 'string' ? record.id : undefined
    const slug = typeof record.slug === 'string' ? record.slug : undefined
    if (id && slug) {
      this.#postIds.set(slug, id)
      this.#postSlugs.set(id, slug)
    }
    if (id) {
      const marker = typeof record.updatedAt === 'string' ? record.updatedAt : ''
      if (marker) this.#contextMarkers.set(id, marker)
    }

    Object.values(record).forEach((item) => this.indexResources(item))
  }

  private rememberInteraction(path: string, memory: SocialMemory): void {
    const match = path.match(
      /^\/posts\/([^/]+)\/(?:comments(?:\/([^/]+)\/(?:replies|reactions))?|reactions|votes)$/u,
    )
    if (!match?.[1]) return

    const postSlug = decodeURIComponent(match[1])
    const postId = this.#postIds.get(postSlug) ?? postSlug
    let updated = memory.recordInteraction({
      resourceType: 'post',
      resourceId: postId,
      contextMarker: this.#contextMarkers.get(postId),
    })
    if (match[2]) {
      const commentId = decodeURIComponent(match[2])
      updated = memory.recordInteraction({
        resourceType: 'comment',
        resourceId: commentId,
        contextMarker: this.#contextMarkers.get(commentId),
      })
    }
    this.setState({ ...this.state, memory: updated })
  }

  private resolvePostPath(path: string): string {
    return path.replace(/^\/posts\/([^/?]+)/u, (match, identifier: string) => {
      const decoded = decodeURIComponent(identifier)
      const slug = this.#postSlugs.get(decoded)

      return slug ? `/posts/${encodeURIComponent(slug)}` : match
    })
  }

  private annotateInteractions(value: unknown, memory: SocialMemory): void {
    if (Array.isArray(value)) {
      value.forEach((item) => this.annotateInteractions(item, memory))

      return
    }
    const record = this.asRecord(value)
    if (Object.keys(record).length === 0) return

    const id = typeof record.id === 'string' ? record.id : undefined
    const interaction = id ? memory.interaction(id) : undefined
    if (id && interaction) {
      const currentMarker = this.#contextMarkers.get(id)
      record._agentInteraction = {
        interactedAt: interaction.interactedAt,
        contextChanged: Boolean(
          currentMarker &&
            Number.isFinite(Date.parse(currentMarker)) &&
            Date.parse(currentMarker) > Date.parse(interaction.interactedAt),
        ),
      }
    }

    Object.values(record).forEach((item) => this.annotateInteractions(item, memory))
  }
}
