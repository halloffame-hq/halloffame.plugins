import type { Env, HttpMethod } from './types'

import { RoutePolicy } from './RoutePolicy'

const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const supportedMedia = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

interface AuthenticationResponse {
  token?: string
  [key: string]: unknown
}

export class HallOfFameClient {
  readonly #baseUrl: URL
  readonly #env: Env
  readonly #policy = new RoutePolicy()

  constructor(env: Env) {
    this.#env = env
    this.#baseUrl = new URL(env.HOF_API_URL.endsWith('/') ? env.HOF_API_URL : `${env.HOF_API_URL}/`)

    if (this.#baseUrl.protocol !== 'https:' || !this.#baseUrl.pathname.endsWith('/api/')) {
      throw new Error('HOF_API_URL must be an HTTPS URL ending in /api.')
    }
  }

  async register(): Promise<AuthenticationResponse> {
    return this.#authenticate('agent/register', {
      username: this.#env.HOF_USERNAME,
      firstname: this.#env.HOF_FIRSTNAME,
      lastname: this.#env.HOF_LASTNAME,
      email: this.#env.HOF_EMAIL,
      password: this.#env.HOF_PASSWORD,
      password_confirmation: this.#env.HOF_PASSWORD,
      agent_provider: this.#env.HOF_AGENT_PROVIDER,
      agent_id: this.#env.HOF_AGENT_ID,
      agent_display_name: `${this.#env.HOF_FIRSTNAME} ${this.#env.HOF_LASTNAME}`.trim(),
      agent_model: this.#env.HOF_MODEL ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
      agent_version: '1',
      agent_metadata: {
        capabilities: ['social-participation'],
        runtime: 'cloudflare-agents'
      },
    })
  }

  async login(): Promise<AuthenticationResponse> {
    return this.#authenticate('auth/login', {
      email: this.#env.HOF_EMAIL,
      password: this.#env.HOF_PASSWORD,
    })
  }

  async request(method: HttpMethod, path: string, token: string, body?: unknown): Promise<unknown> {
    if (!path.startsWith('/') || path.includes('#')) {
      throw new Error('API path must begin with / and must not contain a fragment.')
    }

    if ((method === 'GET' || method === 'DELETE') && body !== undefined) {
      throw new Error(`${method} requests do not accept a JSON body.`)
    }

    const url = new URL(path.slice(1), this.#baseUrl)
    const apiPrefix = this.#baseUrl.pathname

    if (url.origin !== this.#baseUrl.origin || !url.pathname.startsWith(apiPrefix)) {
      throw new Error('API path escaped the configured Hall Of Fame origin.')
    }

    const route = `/${url.pathname.slice(apiPrefix.length)}`.replace(/\/$/, '') || '/'
    this.#policy.assertAllowed(method, route)

    const headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` })
    const init: RequestInit = { method, headers }

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json')
      init.body = JSON.stringify(body)
    }

    return this.#fetchJson(url, init)
  }

  /**
   * Fetch and upload media
   * 
   * @param source 
   * @param context 
   * @param token 
   * @returns 
   */
  async fetchAndUploadMedia(
    source: string,
    context: 'post' | 'status' | null,
    token: string
  ) {
    let url = new URL(source)
    let response: Response | undefined

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      this.#assertMediaUrl(url)
      response = await fetch(url, { redirect: 'manual' })

      if (response.status < 300 || response.status >= 400) break

      const location = response.headers.get('Location')
      if (!location) throw new Error('Media redirect did not provide a destination.')
      url = new URL(location, url)
    }

    if (!response?.ok) {
      throw new Error(`Media download failed with HTTP ${response?.status ?? 'unknown'}.`)
    }

    const contentType = response.headers.get('Content-Type')?.split(';', 1)[0]?.toLowerCase()
    const extension = contentType ? supportedMedia.get(contentType) : undefined
    const declaredLength = Number(response.headers.get('Content-Length') ?? 0)

    if (!extension || !contentType) throw new Error('Media response is not a supported image type.')
    if (declaredLength > MAX_MEDIA_BYTES) throw new Error('Media response exceeds 50 MiB.')

    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('Media response exceeds 50 MiB.')

    const form = new FormData()
    form.set('file', new File([bytes], `media.${extension}`, { type: contentType }))
    if (context) form.set('context', context)

    return this.#fetchJson(new URL('account/uploads', this.#baseUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: form,
    })
  }

  async #authenticate(path: string, body: Record<string, unknown>): Promise<AuthenticationResponse> {
    const response = await this.#fetchJson(new URL(path, this.#baseUrl), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!this.#isRecord(response)) throw new Error('Authentication returned an invalid response.')

    return response
  }

  async #fetchJson(url: URL, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, init)
    const text = await response.text()
    let value: unknown = null

    if (text) {
      try {
        value = JSON.parse(text)
      } catch {
        value = { message: text }
      }
    }

    if (!response.ok) {
      const message = this.#isRecord(value) && typeof value.message === 'string' ? value.message : text
      throw new Error(`Hall Of Fame API returned HTTP ${response.status}${message ? `: ${message}` : '.'}`)
    }

    return value
  }

  #assertMediaUrl(url: URL): void {
    const hostname = url.hostname.toLowerCase()
    const configuredHosts = (this.#env.HOF_MEDIA_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)

    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      hostname === 'localhost' ||
      !hostname.includes('.') ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(':')
    ) {
      throw new Error('Media URL must use an allowed public HTTPS hostname.')
    }

    if (configuredHosts.length > 0 && !configuredHosts.includes(hostname)) {
      throw new Error('Media hostname is not in HOF_MEDIA_HOSTS.')
    }
  }

  #isRecord(value: unknown): value is AuthenticationResponse {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }
}
