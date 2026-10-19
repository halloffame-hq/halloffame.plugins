const MAX_RESULTS = 5
const OPENVERSE = 'https://api.openverse.org/v1'
/** Renew an Openverse token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000
const UPLOADABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export type ImageSource = 'openverse' | 'wikimedia' | 'unsplash' | 'pexels'

/** One image the agent may use, with the credit its licence asks for. */
export interface ImageCandidate {
  source: ImageSource
  /** What to pass to halloffame_media_upload as source_url. */
  url: string
  title: string
  creator: string | null
  license: string
  /** The credit to publish with the image, or null when none is required. */
  credit: string | null
  /** Where the image is described, for the record. */
  page: string
  width: number | null
  height: number | null
}

export interface ImageSearchOptions {
  /** Openverse app credentials for authenticated rate limits; anonymous without them. */
  openverse?: { clientId?: string; clientSecret?: string }
  unsplashKey?: string
  pexelsKey?: string
  /** Identifies the agent to sources that ask for it, such as Wikimedia. */
  userAgent: string
  fetcher?: typeof fetch
}

type Json = Record<string, unknown>

/** A source answered with an error status. */
export class ImageSearchError extends Error {
  constructor(readonly status: number) {
    super(`Image search failed with HTTP ${status}.`)
    this.name = 'ImageSearchError'
  }
}

/**
 * Keyword search for openly licensed images. Openverse and Wikimedia Commons
 * need no key, and Openverse credentials raise its rate limits; Unsplash and
 * Pexels join when their keys are configured.
 * Every candidate carries the credit its licence requires.
 */
export class ImageSearch {
  /** Unsplash asks to be told when one of its photos is used. */
  readonly #downloads = new Map<string, string>()
  #openverseToken: { value: string; expiresAt: number } | null = null
  #openverseTokenRequest: Promise<string | null> | null = null

  constructor(private readonly options: ImageSearchOptions) {}

  sources(): ImageSource[] {
    return [
      'openverse',
      'wikimedia',
      ...(this.options.unsplashKey ? (['unsplash'] as const) : []),
      ...(this.options.pexelsKey ? (['pexels'] as const) : []),
    ]
  }

  async find(query: string, source?: ImageSource): Promise<ImageCandidate[]> {
    const terms = query.trim().slice(0, 100)
    if (!terms) throw new Error('A search query is required.')

    const chosen = source && this.sources().includes(source) ? source : this.sources()[0]!
    if (chosen === 'wikimedia') return await this.wikimedia(terms)
    if (chosen === 'unsplash') return await this.unsplash(terms)
    if (chosen === 'pexels') return await this.pexels(terms)

    return await this.openverse(terms)
  }

  /** Report the use of an image to the source that asks for it; best effort. */
  async used(url: string): Promise<void> {
    const download = this.#downloads.get(url)
    if (!download || !this.options.unsplashKey) return

    await this.fetchJson(download, {
      Authorization: `Client-ID ${this.options.unsplashKey}`,
    }).catch(() => undefined)
  }

  private async openverse(query: string): Promise<ImageCandidate[]> {
    const params = new URLSearchParams({
      q: query,
      license_type: 'commercial',
      size: 'medium,large',
      page_size: String(MAX_RESULTS),
    })
    const data = await this.openverseSearch(`${OPENVERSE}/images/?${params}`)

    return this.list(data.results).map((item) => {
      const license = this.licenseName(item.license, item.license_version)

      return {
        source: 'openverse',
        url: this.text(item.url),
        title: this.text(item.title) || 'Untitled',
        creator: this.text(item.creator) || null,
        license,
        credit: this.isPublicDomain(item.license)
          ? null
          : `Photo: ${this.text(item.creator) || 'Unknown'}, ${license} via Openverse`,
        page: this.text(item.foreign_landing_url),
        width: this.number(item.width),
        height: this.number(item.height),
      } satisfies ImageCandidate
    })
  }

  /**
   * An Openverse request, authenticated when credentials are configured. A
   * rejected token is renewed once; without a working token the request goes
   * out anonymously rather than failing.
   */
  private async openverseSearch(url: string): Promise<Json> {
    const token = await this.openverseAccessToken()
    if (!token) return await this.fetchJson(url)

    try {
      return await this.fetchJson(url, { Authorization: `Bearer ${token}` })
    } catch (error) {
      if (!(error instanceof ImageSearchError) || error.status !== 401) throw error

      this.#openverseToken = null
      const renewed = await this.openverseAccessToken()

      return await this.fetchJson(url, renewed ? { Authorization: `Bearer ${renewed}` } : {})
    }
  }

  /** A current Openverse access token, requested once at a time and renewed before it expires. */
  private async openverseAccessToken(): Promise<string | null> {
    const { clientId, clientSecret } = this.options.openverse ?? {}
    if (!clientId || !clientSecret) return null
    if (this.#openverseToken && this.#openverseToken.expiresAt > Date.now()) {
      return this.#openverseToken.value
    }

    this.#openverseTokenRequest ??= this.requestOpenverseToken(clientId, clientSecret).finally(
      () => {
        this.#openverseTokenRequest = null
      },
    )

    return await this.#openverseTokenRequest
  }

  private async requestOpenverseToken(
    clientId: string,
    clientSecret: string,
  ): Promise<string | null> {
    try {
      const response = await (this.options.fetcher ?? fetch)(`${OPENVERSE}/auth_tokens/token/`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': this.options.userAgent,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      })
      if (!response.ok) return null

      const data = this.record(await response.json())
      if (typeof data.access_token !== 'string') return null

      const lifetime = (this.number(data.expires_in) ?? 3600) * 1000
      this.#openverseToken = {
        value: data.access_token,
        expiresAt: Date.now() + Math.max(lifetime - TOKEN_MARGIN_MS, 0),
      }

      return data.access_token
    } catch {
      return null
    }
  }

  private async wikimedia(query: string): Promise<ImageCandidate[]> {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: `filetype:bitmap ${query}`,
      gsrnamespace: '6',
      gsrlimit: String(MAX_RESULTS * 2),
      prop: 'imageinfo',
      iiprop: 'url|size|mime|extmetadata',
      iiurlwidth: '1200',
      iiextmetadatafilter: 'Artist|LicenseShortName|AttributionRequired',
      format: 'json',
      formatversion: '2',
    })
    const data = await this.fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`)
    const pages = this.list(this.record(data.query).pages)

    return pages
      .map((page) => ({ page, info: this.record(this.list(page.imageinfo)[0]) }))
      .filter(({ info }) => UPLOADABLE.has(this.text(info.mime)))
      .slice(0, MAX_RESULTS)
      .map(({ page, info }) => {
        const meta = this.record(info.extmetadata)
        const field = (key: string) => this.stripHtml(this.text(this.record(meta[key]).value))
        const license = field('LicenseShortName') || 'Free license'
        const creator = field('Artist') || null

        return {
          source: 'wikimedia',
          url: this.text(info.thumburl) || this.text(info.url),
          title: this.text(page.title).replace(/^File:/u, ''),
          creator,
          license,
          credit:
            field('AttributionRequired') === 'false'
              ? null
              : `Photo: ${creator ?? 'Unknown'}, ${license} via Wikimedia Commons`,
          page: this.text(info.descriptionurl),
          width: this.number(info.thumbwidth ?? info.width),
          height: this.number(info.thumbheight ?? info.height),
        } satisfies ImageCandidate
      })
  }

  private async unsplash(query: string): Promise<ImageCandidate[]> {
    const params = new URLSearchParams({ query, per_page: String(MAX_RESULTS) })
    const data = await this.fetchJson(`https://api.unsplash.com/search/photos?${params}`, {
      Authorization: `Client-ID ${this.options.unsplashKey}`,
      'Accept-Version': 'v1',
    })

    return this.list(data.results).map((item) => {
      const urls = this.record(item.urls)
      const links = this.record(item.links)
      const user = this.record(item.user)
      const url = this.text(urls.regular)
      if (typeof links.download_location === 'string') {
        this.#downloads.set(url, links.download_location)
      }

      return {
        source: 'unsplash',
        url,
        title: this.text(item.alt_description) || this.text(item.description) || 'Untitled',
        creator: this.text(user.name) || null,
        license: 'Unsplash License',
        credit: `Photo by ${this.text(user.name) || 'Unknown'} on Unsplash`,
        page: this.text(links.html),
        width: this.number(item.width),
        height: this.number(item.height),
      } satisfies ImageCandidate
    })
  }

  private async pexels(query: string): Promise<ImageCandidate[]> {
    const params = new URLSearchParams({ query, per_page: String(MAX_RESULTS) })
    const data = await this.fetchJson(`https://api.pexels.com/v1/search?${params}`, {
      Authorization: String(this.options.pexelsKey),
    })

    return this.list(data.photos).map((item) => {
      const src = this.record(item.src)

      return {
        source: 'pexels',
        url: this.text(src.large),
        title: this.text(item.alt) || 'Untitled',
        creator: this.text(item.photographer) || null,
        license: 'Pexels License',
        credit: `Photo by ${this.text(item.photographer) || 'Unknown'} on Pexels`,
        page: this.text(item.url),
        width: this.number(item.width),
        height: this.number(item.height),
      } satisfies ImageCandidate
    })
  }

  private async fetchJson(url: string, headers: Record<string, string> = {}): Promise<Json> {
    const response = await (this.options.fetcher ?? fetch)(url, {
      headers: { Accept: 'application/json', 'User-Agent': this.options.userAgent, ...headers },
    })
    if (!response.ok) throw new ImageSearchError(response.status)

    return this.record(await response.json())
  }

  private licenseName(license: unknown, version: unknown): string {
    const code = this.text(license).toLowerCase()
    if (code === 'cc0') return 'CC0'
    if (code === 'pdm') return 'Public Domain'

    return `CC ${code.toUpperCase()} ${this.text(version)}`.trim()
  }

  private isPublicDomain(license: unknown): boolean {
    return ['cc0', 'pdm'].includes(this.text(license).toLowerCase())
  }

  private stripHtml(value: string): string {
    return value
      .replace(/<[^>]*>/gu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 120)
  }

  private list(value: unknown): Json[] {
    return Array.isArray(value) ? value.map((item) => this.record(item)) : []
  }

  private record(value: unknown): Json {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Json)
      : {}
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
  }
}
