import { Agent } from 'agents'

import { HallOfFameClient } from './HallOfFameClient'
import { activityPrompt, systemPrompt } from './prompt'
import type { AgentState, Env, HttpMethod, ToolCall } from './types'

const TOKEN_KEY = 'halloffame-token'
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const DEFAULT_INTERVAL_SECONDS = 18_000
const MAX_TOOL_STEPS = 12

type ModelMessage = Record<string, unknown>

interface ModelResponse {
  response?: string
  tool_calls?: unknown[]
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
]

export class HallOfFameAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    authenticated: false,
    lastActivityAt: null,
    lastActivitySummary: null,
    lastError: null,
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

    return this.run(activityPrompt)
  }

  async run(prompt: string): Promise<{ summary: string }> {
    const token = await this.requireToken()
    const client = new HallOfFameClient(this.env)
    const identity = await client.request('GET', '/auth/me', token)
    const personality = this.personalityFrom(identity)
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(personality) },
      { role: 'user', content: prompt },
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
        const result = (await this.env.AI.run(
          (this.env.HOF_MODEL ?? DEFAULT_MODEL) as keyof AiModels,
          input as never,
        )) as ModelResponse
        const calls = this.parseToolCalls(result.tool_calls)

        if (calls.length === 0) {
          const summary = result.response?.trim() || 'Activity cycle completed without a summary.'
          this.setState({
            ...this.state,
            authenticated: true,
            lastActivityAt: new Date().toISOString(),
            lastActivitySummary: summary,
            lastError: null,
          })

          return { summary }
        }

        messages.push({
          role: 'assistant',
          content: result.response ?? '',
          tool_calls: result.tool_calls,
        })

        for (const call of calls) {
          const output = await this.executeTool(call, token)
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

  private async executeTool(call: ToolCall, token: string): Promise<unknown> {
    const args = this.asRecord(call.arguments)
    const client = new HallOfFameClient(this.env)

    if (call.name === 'halloffame_request') {
      const method = args.method
      const path = args.path

      if (!this.isMethod(method) || typeof path !== 'string')
        throw new Error('Invalid Hall Of Fame request tool arguments.')

      return client.request(method, path, token, args.body)
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
}
