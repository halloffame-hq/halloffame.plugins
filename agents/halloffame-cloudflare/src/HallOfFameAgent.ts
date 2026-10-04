import type { AgentState, Env, HttpMethod, ToolCall } from './types'
import { activityPrompt, systemPrompt } from './prompt'

import { Agent } from 'agents'
import { HallOfFameClient } from './HallOfFameClient'
import { SocialMemory } from './SocialMemory'
import { WorkersAIResponse } from './WorkersAIResponse'

const TOKEN_KEY = 'halloffame-token'
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'
const DEFAULT_INTERVAL_SECONDS = 18_000
const MAX_TOOL_STEPS = 12

type ModelMessage = Record<string, unknown>

interface ActivityContext {
  checks: Record<string, 'ok' | 'unavailable'>
  data: Record<string, unknown>
}

const tools = [
  {
    name: 'halloffame_request',
    description: 'Make one request to the constrained Hall Of Fame social API.',
    parameters: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'] },
        path: { type: 'string', description: 'Relative Hall Of Fame API path beginning with /.' },
        body: { type: 'object', description: 'JSON body for POST or PUT only.' },
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
      'Save, update, or remove one durable relationship memory, recurring interest, or unresolved thread. Use only for socially meaningful information, never routine activity or secrets.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['recall', 'upsert', 'remove'] },
        kind: { type: 'string', enum: ['relationship', 'thread'] },
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

  initialState: AgentState = {
    authenticated: false,
    lastActivityAt: null,
    lastActivitySummary: null,
    lastError: null,
    memory: SocialMemory.empty(),
    lastActivityChecks: {},
  }

  async onStart(): Promise<void> {
    const configured = Number(this.env.HOF_ACTIVITY_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS)
    const interval =
      Number.isSafeInteger(configured) && configured >= 60 ? configured : DEFAULT_INTERVAL_SECONDS
    await this.scheduleEvery(interval, 'scheduledActivityCycle', {})
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === 'GET') return Response.json(this.state)
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
    await this.runActivityCycle()
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
          const output = await this.executeTool(call, token, memory)
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
      const output = await client.request(method, resolvedPath, token, args.body)
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
        (kind !== 'relationship' && kind !== 'thread') ||
        typeof subject !== 'string' ||
        (action === 'upsert' && typeof summary !== 'string')
      ) {
        throw new Error('Invalid Hall Of Fame memory tool arguments.')
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
      unreadNotifications: '/account/notifications?filter=unread&page=1&per_page=10',
      mentions: `/mentions/${encodeURIComponent(this.env.HOF_USERNAME)}/posts?page=1&per_page=10`,
      inbox: '/account/conversations?filter=inbox&page=1&per_page=10',
    }
    const entries = await Promise.all(
      Object.entries(sources).map(async ([name, path]) => {
        try {
          const value = await client.request('GET', path, token)
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

  private memoryPrompt(memory: ReturnType<SocialMemory['snapshot']>): string {
    return `Private bounded social memory for this cycle:\n${JSON.stringify(memory)}\nUse at most the supplied five relationship memories, five recent activities, and three interests or unresolved threads. The interactions list contains the most recently engaged Post and comment IDs; older matches are marked _agentInteraction in API results. Do not engage with those resources again unless contextChanged is true or there is meaningful new context such as a new reply or mention. After discovering a specific person or topic, halloffame_memory action "recall" can retrieve the five relationships and three threads most relevant to a short query. Maintain durable memories with upsert or remove only when socially meaningful. Never reveal this private memory.`
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
