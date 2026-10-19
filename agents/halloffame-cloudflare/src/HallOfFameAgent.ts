import type {
  AgentState,
  Env,
  HostedRun,
  HttpMethod,
  ModelUsage,
  RequestFailure,
  ToolCall,
} from './types'
import { type RunMode, activityPrompt, systemPrompt } from './prompt'

import { Agent } from 'agents'
import { AgentSuspension } from './AgentSuspension'
import { AuthoredText } from './AuthoredText'
import { HallOfFameClient } from './HallOfFameClient'
import { HostedRunPrompt } from './HostedRunPrompt'
import { ImageSearch, type ImageSource } from './ImageSearch'
import { InteractionLookup } from './InteractionLookup'
import { MinimalInteractionPolicy } from './MinimalInteractionPolicy'
import { PICTWO_CATEGORIES, PICTWO_SHAPES, Pictwo } from './Pictwo'
import { RequestBodyNormalizer } from './RequestBodyNormalizer'
import { RequestRetryPolicy } from './RequestRetryPolicy'
import { RunFailure } from './RunFailure'
import { SocialMemory } from './SocialMemory'
import { StructuredReplies } from './StructuredReplies'
import { WorkersAIResponse } from './WorkersAIResponse'

const TOKEN_KEY = 'halloffame-token'
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it'
const DEFAULT_INTERVAL_SECONDS = 18_000
const MAX_TOOL_STEPS = 12
const MAX_EMPTY_MODEL_RETRIES = 2
const MAX_REQUEST_FAILURES = 20
const MAX_OUTPUT_TOKENS = 4096

/** Instances named with this prefix run accounts for the platform rather than for an operator. */
export const HOSTED_PREFIX = 'automation-'

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
        notification_id: {
          type: 'string',
          description:
            'Unread notification id that directly prompted this mutation. Required for mutations during minimal operations.',
        },
      },
      required: ['method', 'path'],
    },
  },
  {
    name: 'halloffame_media_upload',
    description:
      'Upload one image to Hall Of Fame and return its media id. Either name a Pictwo photo with pictwo_category and pictwo_seed, or pass source_url for another reusable public HTTPS image.',
    parameters: {
      type: 'object',
      properties: {
        pictwo_category: {
          type: 'string',
          enum: [...PICTWO_CATEGORIES],
          description: 'Pictwo photo category closest to the subject.',
        },
        pictwo_seed: {
          type: 'string',
          description:
            'A few words about the subject. The same seed always gives the same photo; change it for another.',
        },
        pictwo_shape: {
          type: 'string',
          enum: Object.keys(PICTWO_SHAPES),
          description:
            'landscape for Posts, banner for a cover, square for a profile picture, portrait for a Story.',
        },
        source_url: {
          type: 'string',
          description: 'Any other reusable public HTTPS image.',
        },
        context: {
          type: 'string',
          enum: ['post', 'status', 'profile'],
          description:
            'post for a Post, status for a Story, profile for a profile picture or cover.',
        },
      },
      required: [],
    },
  },
  {
    name: 'halloffame_find_image',
    description:
      'Search openly licensed images of a specific subject, such as a named place, landmark, event, person, or object, and get up to five candidates, each with the credit its licence requires. Upload one with halloffame_media_upload source_url. For a broad theme, use a Pictwo category instead of searching.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few words describing the image wanted.' },
        source: {
          type: 'string',
          enum: ['openverse', 'wikimedia', 'unsplash', 'pexels'],
          description:
            'wikimedia for real places, events, landmarks, and people; openverse for other specific subjects; unsplash and pexels for polished stock photos when configured.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'halloffame_view_image',
    description:
      'Look at one image from a Post, comment, or profile you already fetched, before answering about it. Pass its thumbnail or mediaUrl. Works only when the model accepts images; the image is shown to you on your next turn.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTPS image URL taken from a fetched resource.',
        },
      },
      required: ['url'],
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
  #tokenRefresh: Promise<string> | null = null
  /** The platform run in progress, whose credential, API, and settings replace the operator's. */
  #hosted: HostedRun | null = null
  #usage: ModelUsage = { inputTokens: 0, outputTokens: 0 }
  #hostedQueue: Promise<void> = Promise.resolve()
  #imageSearch: ImageSearch | null = null

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
    // The platform decides when a hosted account runs; only operator agents keep their own cycle.
    if (this.name.startsWith(HOSTED_PREFIX)) return

    await this.scheduleEvery(this.activityIntervalSeconds(), 'scheduledActivityCycle', {})
  }

  /** Accept a platform run and carry it out in the background. */
  async startHostedRun(dispatch: HostedRun): Promise<void> {
    await this.schedule(0, 'executeHostedRun', dispatch)
  }

  /** Carry out one platform run, then report its outcome and usage to the API. */
  /** Routine replies: the interactions are read, then answered in one structured model call. */
  private async answerInteractions(dispatch: HostedRun): Promise<{ summary: string }> {
    const client = this.createClient()
    const identity = await client.request('GET', '/auth/me', dispatch.credential)
    const request = (method: HttpMethod, path: string, body?: unknown) =>
      client.request(method, path, dispatch.credential, body)

    return new StructuredReplies({
      request,
      ask: (messages, schema) => this.requestStructured(messages, schema),
      lookup: new InteractionLookup({
        request,
        appUrl: dispatch.appUrl ?? null,
        self: dispatch.account.username,
        vision: this.modelSupportsVision(),
      }),
      self: dispatch.account,
    }).answer(dispatch.run.triggers, systemPrompt(this.personalityFrom(identity), 'interaction'))
  }

  /** One model call constrained to a JSON schema; its usage counts toward the run. */
  private async requestStructured(
    messages: Record<string, unknown>[],
    schema: Record<string, unknown>,
  ): Promise<unknown> {
    const rawResult = await this.env.AI.run(this.model<keyof AiModels>(), {
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'automation_replies', strict: true, schema },
      },
      max_tokens: MAX_OUTPUT_TOKENS,
    } as never)
    const response = new WorkersAIResponse(rawResult)
    this.countUsage(response.normalize().usage)

    return response.content()
  }

  /** Stream a step or message of a platform run to its owner and managers; best effort. */
  private async emit(type: 'progress' | 'message', text: string): Promise<void> {
    if (!this.#hosted || !text.trim()) return

    try {
      await this.createClient().request('POST', this.#hosted.eventsPath, this.#hosted.credential, {
        type,
        text: text.slice(0, 2000),
      })
    } catch {
      // The run goes on whether or not anyone is watching it.
    }
  }

  /** A plain account of one tool step, for whoever is watching the run. */
  private describeStep(call: ToolCall): string {
    const args = this.asRecord(call.arguments)
    if (call.name === 'halloffame_media_upload') {
      const source = this.mediaSourceFrom(args)

      return source
        ? `Uploaded an image from ${source}`
        : 'Tried to upload an image without a source.'
    }
    if (call.name === 'halloffame_memory') return 'Updated its memory.'
    if (call.name === 'halloffame_find_image') {
      return `Searched ${typeof args.source === 'string' ? args.source : 'openverse'} for images of "${String(args.query ?? '')}"`
    }
    if (call.name === 'halloffame_view_image') return 'Looked at an image.'

    const verbs: Record<string, string> = {
      GET: 'Read',
      POST: 'Posted to',
      PUT: 'Updated',
      DELETE: 'Removed',
    }

    return `${verbs[String(args.method)] ?? 'Called'} ${String(args.path ?? '')}`.trim()
  }

  private model<X extends string = string>(): X {
    return (this.#hosted?.model || this.env.HOF_MODEL || DEFAULT_MODEL) as X
  }

  private countUsage(usage: ModelUsage): void {
    this.#usage = {
      inputTokens: this.#usage.inputTokens + usage.inputTokens,
      outputTokens: this.#usage.outputTokens + usage.outputTokens,
    }
  }

  /**
   * Carry out platform runs one after another. A Durable Object interleaves
   * work at every await, and a run's credential and API live on the instance
   * while it runs, so a second run must wait for the first to finish.
   */
  async executeHostedRun(dispatch: HostedRun): Promise<void> {
    const turn = this.#hostedQueue.then(() => this.carryOutHostedRun(dispatch))
    this.#hostedQueue = turn.catch(() => undefined)

    await turn
  }

  private async carryOutHostedRun(dispatch: HostedRun): Promise<void> {
    this.#hosted = dispatch
    this.#usage = { inputTokens: 0, outputTokens: 0 }
    let report: Record<string, unknown>

    try {
      const result: { summary: string; steps?: string[] } =
        dispatch.run.kind === 'interaction'
          ? await this.answerInteractions(dispatch)
          : await this.run(
              HostedRunPrompt.for(dispatch),
              false,
              dispatch.run.kind === 'scheduled' ? 'activity' : 'instruction',
            )
      await this.emit('message', result.summary)
      // The steps follow the agent's own account, so what it says can be checked against what it did.
      const trail = RunFailure.trailOf(result.steps ?? [])
      const summary = trail ? `${result.summary}\n\n**Steps**\n\n${trail}` : result.summary
      report = { status: 'completed', summary: summary.slice(0, 5000) }
    } catch (error) {
      // A failed run still reports the steps it took, so its owner can see where it went.
      const trail = error instanceof RunFailure ? error.trail() : null
      report = {
        status: 'failed',
        error: this.errorMessage(error).slice(0, 255),
        ...(trail ? { summary: trail.slice(0, 5000) } : {}),
      }
    }

    try {
      // The report uses this run's own credential and API, never whatever is on the instance.
      await new HallOfFameClient(this.env, undefined, dispatch.apiBaseUrl).request(
        'POST',
        dispatch.reportPath,
        dispatch.credential,
        {
          ...report,
          input_tokens: this.#usage.inputTokens,
          output_tokens: this.#usage.outputTokens,
        },
      )
    } finally {
      this.#hosted = null
    }
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === 'GET') {
      const { memory: _memory, ...status } = this.state

      return Response.json(status)
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

    try {
      const input = (await request.json()) as {
        action?: unknown
        prompt?: unknown
        data?: unknown
        source_url?: unknown
      }

      if (
        !['register', 'login', 'logout'].includes(String(input.action)) &&
        (await this.suspended())
      ) {
        return Response.json({ suspended: true, error: AgentSuspension.message }, { status: 409 })
      }

      switch (input.action) {
        case 'register':
          return Response.json(await this.register())
        case 'login':
          return Response.json(await this.login())
        case 'activity-cycle':
          return Response.json(await this.runActivityCycle(false))
        case 'run':
          if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
            return Response.json({ error: 'A non-empty prompt is required.' }, { status: 422 })
          }

          return Response.json(await this.run(input.prompt, false, 'instruction'))
        case 'create-post':
          return Response.json(await this.directRequest('POST', '/posts', input.data))
        case 'create-story':
        case 'create-status':
          return Response.json(await this.directRequest('POST', '/stories', input.data))
        case 'update-profile':
          return Response.json(await this.updateProfile(input.data))
        case 'set-avatar':
          if (typeof input.source_url !== 'string' || input.source_url.trim() === '') {
            return Response.json({ error: 'A non-empty source_url is required.' }, { status: 422 })
          }

          return Response.json(await this.setAvatar(input.source_url))
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
      await this.runActivityCycle(true)
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

  private async directRequest(method: HttpMethod, path: string, data: unknown): Promise<unknown> {
    const body = this.asRecord(data)
    if (Object.keys(body).length === 0) throw new Error('A non-empty data object is required.')

    const token = await this.requireToken()

    return this.createClient().request(method, path, token, body)
  }

  private async updateProfile(data: unknown): Promise<unknown> {
    const supplied = this.asRecord(data)
    const allowed = new Set([
      'username',
      'firstname',
      'lastname',
      'about',
      'website',
      'is_private',
      'personality',
    ])
    const profile = Object.fromEntries(
      Object.entries(supplied).filter(([field]) => allowed.has(field)),
    )
    if (Object.keys(profile).length === 0) {
      throw new Error('No supported profile fields were provided in data.')
    }

    return this.directRequest('PUT', '/account/profile', profile)
  }

  private async setAvatar(sourceUrl: string): Promise<{ upload: unknown; profile: unknown }> {
    let token = await this.requireToken()
    const client = this.createClient()
    const upload = await client.fetchAndUploadMedia(sourceUrl.trim(), null, token)
    const mediaId = this.mediaIdFrom(upload)
    if (!mediaId) throw new Error('Media upload response did not contain a media id.')

    token = await this.requireToken()
    const profile = await client.request('POST', '/account/avatar', token, {
      avatar_media_id: mediaId,
    })

    return { upload, profile }
  }

  private mediaIdFrom(value: unknown): string | undefined {
    const response = this.asRecord(value)
    const data = this.asRecord(response.data)
    const media = this.asRecord(data.media)
    const id = data.id ?? media.id ?? response.id

    return typeof id === 'string' && id !== '' ? id : undefined
  }

  async runActivityCycle(enforceInterval = false): Promise<{
    summary: string
    skipped?: boolean
    nextActivityAt?: string | null
  }> {
    if (!enforceInterval) return this.run(activityPrompt, true)

    const token = await this.requireToken()
    const claim = await this.createClient().request(
      'POST',
      '/account/agent/activity-lease',
      token,
      { source: 'scheduled', interval_seconds: this.activityIntervalSeconds() },
    )
    const lease = this.asRecord(this.asRecord(claim).data)

    if (lease.acquired !== true) {
      const nextActivityAt = typeof lease.nextActivityAt === 'string' ? lease.nextActivityAt : null
      const summary = AgentSuspension.fromLease(lease)
        ? AgentSuspension.message
        : nextActivityAt
          ? `Activity cycle skipped. Another runtime holds the interval until ${nextActivityAt}.`
          : 'Activity cycle skipped. This runtime did not acquire the activity interval.'

      this.setState({
        ...this.state,
        authenticated: true,
        lastActivitySummary: summary,
        lastError: null,
      })

      return { summary, skipped: true, nextActivityAt }
    }

    return this.run(activityPrompt, true)
  }

  async run(
    prompt: string,
    preloadActivity = false,
    mode: RunMode = 'activity',
  ): Promise<{ summary: string; steps: string[] }> {
    let token = await this.requireToken()
    const client = this.createClient()
    const identity = await client.request('GET', '/auth/me', token)
    token = await this.requireToken()
    const personality = this.personalityFrom(identity)
    const memory = new SocialMemory(this.state.memory ?? SocialMemory.empty())
    const minimalCycle = preloadActivity && this.minimalOperationsEnabled()
    const activityContext = preloadActivity
      ? await this.loadActivityContext(client, token, memory)
      : undefined
    const minimalPolicy =
      minimalCycle && activityContext
        ? new MinimalInteractionPolicy(activityContext.data.unreadNotifications)
        : undefined
    if (activityContext) {
      this.setState({ ...this.state, lastActivityChecks: activityContext.checks })
    }
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(personality, mode) },
      {
        role: 'system',
        content: `Authenticated Hall Of Fame account state for this cycle:\n${JSON.stringify(identity)}`,
      },
      { role: 'system', content: this.memoryPrompt(memory.snapshot(prompt)) },
      {
        role: 'user',
        content: activityContext
          ? `${prompt}\n\nMinimal operations: ${minimalCycle ? 'enabled' : 'disabled'}.\nPreloaded direct-interaction sources:\n${JSON.stringify(activityContext.data)}`
          : prompt,
      },
    ]
    let visionImage: string | undefined
    const steps: string[] = []

    try {
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        // Near the limit the model is told to finish; on the last turn it can only answer.
        const remaining = MAX_TOOL_STEPS - step
        const finalTurn = remaining === 1
        if (remaining === 3 || finalTurn) {
          messages.push({
            role: 'system',
            content: finalTurn
              ? 'This is your last turn and no tools remain. Return a short factual summary of what was done and what was not.'
              : 'Only two tool steps remain. Finish the task now with what you have: publish it, or stop and summarize.',
          })
        }

        const result = await this.requestModel(messages, visionImage, !finalTurn)
        visionImage = undefined
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

          return { summary, steps }
        }

        messages.push({
          role: 'assistant',
          content: result.text,
          tool_calls: result.toolCalls,
        })

        for (const call of calls) {
          const output = call.argumentError
            ? { error: call.argumentError, retriable: true }
            : await this.executeToolSafely(call, token, memory, minimalPolicy)
          const failure = this.asRecord(output).error
          steps.push(
            `${this.describeStep(call)}${typeof failure === 'string' ? ` (failed: ${failure.slice(0, 160)})` : ''}`,
          )
          await this.emit('progress', this.describeStep(call))
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
      throw error instanceof RunFailure ? error : new RunFailure(message, steps)
    }
  }

  private async requestModel(
    messages: ModelMessage[],
    visionImage?: string,
    withTools = true,
  ): Promise<ReturnType<WorkersAIResponse['normalize']>> {
    for (let attempt = 0; attempt <= MAX_EMPTY_MODEL_RETRIES; attempt += 1) {
      const retryInstruction =
        attempt > 0
          ? [
              {
                role: 'system',
                content:
                  'The previous model turn was empty. Continue from the existing conversation. Return the required tool call, or a concise factual final response if the task is complete.',
              },
            ]
          : []
      const rawResult = await this.env.AI.run(this.model<keyof AiModels>(), {
        messages: [...messages, ...retryInstruction],
        ...(withTools ? { tools } : {}),
        max_tokens: MAX_OUTPUT_TOKENS,
        // A retry goes without the image, in case the model could not take it.
        ...(visionImage && attempt === 0 ? { image: visionImage } : {}),
      } as never)
      const result = new WorkersAIResponse(rawResult).normalize()
      this.countUsage(result.usage)
      if (result.text || result.toolCalls.length > 0) return result
    }

    throw new Error(
      `Workers AI returned neither text nor tool calls after ${MAX_EMPTY_MODEL_RETRIES + 1} attempts.`,
    )
  }

  private async executeTool(
    call: ToolCall,
    _token: string,
    memory: SocialMemory,
    minimalPolicy?: MinimalInteractionPolicy,
  ): Promise<unknown> {
    const args = this.asRecord(call.arguments)
    const client = this.createClient()
    const token = await this.requireToken()

    if (call.name === 'halloffame_request') {
      const method = args.method
      const path = args.path

      if (!this.isMethod(method) || typeof path !== 'string')
        throw new Error('Invalid Hall Of Fame request tool arguments.')

      const notificationId =
        typeof args.notification_id === 'string' ? args.notification_id : undefined
      minimalPolicy?.assertAllowed(method, path, notificationId)

      const resolvedPath = this.resolvePostPath(path)
      const body = AuthoredText.body(this.#bodyNormalizer.normalize(resolvedPath, args.body))
      const output = await client.request(method, resolvedPath, token, body)
      if (method !== 'GET' && method !== 'PUT') minimalPolicy?.recordMutation(notificationId)
      if (method === 'GET') {
        this.indexResources(output)
        this.annotateInteractions(output, memory)
      }
      if (method === 'POST') this.rememberInteraction(resolvedPath, memory)

      return output
    }

    if (call.name === 'halloffame_media_upload') {
      const sourceUrl = this.mediaSourceFrom(args)
      if (!sourceUrl) {
        throw new Error(
          args.pictwo_category !== undefined
            ? `pictwo_category must be one of: ${PICTWO_CATEGORIES.join(', ')}.`
            : 'Pass pictwo_category with pictwo_seed, or a source_url.',
        )
      }

      const context = this.mediaContext(args.context)
      const uploaded = await client.fetchAndUploadMedia(sourceUrl, context, token)
      await this.images().used(sourceUrl)

      return uploaded
    }

    if (call.name === 'halloffame_find_image') {
      if (typeof args.query !== 'string') throw new Error('A search query is required.')

      const images = this.images()
      const candidates = await images.find(args.query, args.source as ImageSource | undefined)

      return {
        images: candidates,
        sources: images.sources(),
        next: 'Upload one with halloffame_media_upload source_url. When its credit is not null, publish that credit with it.',
      }
    }

    if (call.name === 'halloffame_view_image') {
      if (!this.modelSupportsVision())
        return { viewed: false, reason: 'The model cannot see images.' }
      if (!this.viewableImage(args.url)) throw new Error('An HTTPS image URL is required.')

      return { viewed: true }
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
    minimalPolicy?: MinimalInteractionPolicy,
  ): Promise<unknown> {
    const args = this.asRecord(call.arguments)
    const method = this.isMethod(args.method) ? args.method : 'POST'
    let lastError: unknown

    for (let attempt = 1; attempt <= this.#retryPolicy.maxAttempts; attempt += 1) {
      try {
        return await this.executeTool(call, token, memory, minimalPolicy)
      } catch (error) {
        lastError = error
        const retriable = this.#retryPolicy.isRetriable(error, method)
        if (!retriable || attempt === this.#retryPolicy.maxAttempts) {
          const message = this.errorMessage(error)
          this.recordRequestFailure(
            `${method} ${String(args.path ?? call.name)}`,
            message,
            attempt,
            retriable,
          )

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
      let argumentError: string | undefined
      if (typeof rawArguments === 'string') {
        try {
          parsedArguments = JSON.parse(rawArguments)
        } catch {
          // Answered as a tool error so the model can correct the call instead of ending the run.
          parsedArguments = {}
          argumentError =
            'The tool arguments were not valid JSON. Send the call again with a valid JSON object.'
        }
      }

      return {
        id: typeof value.id === 'string' ? value.id : undefined,
        name,
        arguments: parsedArguments,
        ...(argumentError ? { argumentError } : {}),
      }
    })
  }

  /**
   * The image the model sees on its next turn: one it uploaded,
   * or one it asked to look at.
   *
   * @param call
   * @returns
   */
  private visionImageFrom(call: ToolCall): string | undefined {
    if (!this.modelSupportsVision()) return undefined

    const args = this.asRecord(call.arguments)
    const url =
      call.name === 'halloffame_media_upload'
        ? this.mediaSourceFrom(args)
        : call.name === 'halloffame_view_image'
          ? args.url
          : undefined

    return this.viewableImage(url) ? url : undefined
  }

  /** Image search for this instance, keeping what it found so a used image can be reported. */
  private images(): ImageSearch {
    this.#imageSearch ??= new ImageSearch({
      openverse: {
        clientId: this.env.HOF_OPENVERSE_CLIENT_ID,
        clientSecret: this.env.HOF_OPENVERSE_CLIENT_SECRET,
      },
      unsplashKey: this.env.HOF_UNSPLASH_ACCESS_KEY,
      pexelsKey: this.env.HOF_PEXELS_API_KEY,
      userAgent: this.createClient().userAgent(),
    })

    return this.#imageSearch
  }

  /**
   * The image a media upload fetches: the named Pictwo photo, or the URL given.
   */
  private mediaSourceFrom(args: Record<string, unknown>): string | null {
    if (typeof args.source_url === 'string' && /^https:\/\//u.test(args.source_url.trim())) {
      return args.source_url.trim()
    }

    const category = Pictwo.category(args.pictwo_category)
    if (category) {
      const shape =
        typeof args.pictwo_shape === 'string' && args.pictwo_shape in PICTWO_SHAPES
          ? (args.pictwo_shape as keyof typeof PICTWO_SHAPES)
          : 'landscape'

      return Pictwo.url(
        category,
        typeof args.pictwo_seed === 'string' ? args.pictwo_seed : '',
        shape,
      )
    }

    return null
  }

  /** Where an upload will be used, read leniently: anything but a Post or Story is profile media. */
  private mediaContext(value: unknown): 'post' | 'status' | null {
    const context = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (context === 'post') return 'post'
    if (context === 'status' || context === 'story') return 'status'

    return null
  }

  private viewableImage(url: unknown): url is string {
    try {
      return typeof url === 'string' && new URL(url).protocol === 'https:'
    } catch {
      return false
    }
  }

  private modelSupportsVision(): boolean {
    if (this.#hosted) return this.#hosted.vision === true

    return this.env.HOF_MODEL_SUPPORTS_VISION?.trim().toLowerCase() === 'true'
  }

  private async requireToken(): Promise<string> {
    if (this.#hosted) return this.#hosted.credential

    const token = await this.ctx.storage.get<string>(TOKEN_KEY)
    if (token) return token

    const response = await new HallOfFameClient(this.env).login()
    await this.storeToken(response.token)

    return response.token as string
  }

  private createClient(): HallOfFameClient {
    // A platform credential cannot be refreshed; an expired one ends the run.
    if (this.#hosted) return new HallOfFameClient(this.env, undefined, this.#hosted.apiBaseUrl)

    return new HallOfFameClient(this.env, () => this.refreshToken())
  }

  private refreshToken(): Promise<string> {
    if (this.#tokenRefresh) return this.#tokenRefresh

    const refresh = new HallOfFameClient(this.env)
      .login()
      .then(async (response) => {
        await this.storeToken(response.token)

        return response.token as string
      })
      .finally(() => {
        this.#tokenRefresh = null
      })

    this.#tokenRefresh = refresh

    return refresh
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

  /** Whether the API has stood this agent down for platform automation. */
  private async suspended(): Promise<boolean> {
    const identity = await this.createClient().request('GET', '/auth/me', await this.requireToken())

    return AgentSuspension.fromIdentity(identity)
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
    const sources = this.minimalOperationsEnabled()
      ? {
          unreadNotifications: '/account/notifications?filter=unread&page=1&per_page=20',
        }
      : {
          unreadNotifications: '/account/notifications?filter=unread&page=1&per_page=20',
          mentions: `/mentions/${encodeURIComponent(this.env.HOF_USERNAME)}/posts?page=1&per_page=20`,
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
          this.recordRequestFailure(
            `${method} ${path}`,
            this.errorMessage(error),
            attempt,
            retriable,
          )
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
      matchingIndex >= 0 ? failures.filter((_, index) => index !== matchingIndex) : failures
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
    if (this.#hosted) return this.#hosted.settings.personalityLearning === true

    return this.env.HOF_PERSONALITY_LEARNING_ENABLED?.trim().toLowerCase() === 'true'
  }

  private minimalOperationsEnabled(): boolean {
    if (this.#hosted) return this.#hosted.settings.minimalOperations === true

    return this.env.HOF_MINIMAL_OPERATIONS?.trim().toLowerCase() === 'true'
  }

  private activityIntervalSeconds(): number {
    const configured = Number(this.env.HOF_ACTIVITY_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS)

    return Number.isSafeInteger(configured) && configured >= 60 && configured <= 86_400
      ? configured
      : DEFAULT_INTERVAL_SECONDS
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
