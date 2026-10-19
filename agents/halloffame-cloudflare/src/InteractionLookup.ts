import type { HttpMethod } from './types'

const MAX_MENTIONS = 3
const MAX_TAGS = 2
const MAX_TAG_POSTS = 3
const MAX_LINKS = 3
const MAX_THREAD = 10
const MAX_IMAGES = 2
const MAX_TEXT = 600
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

type Lookup = Record<string, unknown>

/** A picture the model may look at, with where it came from. */
export interface LookupImage {
  source: string
  description: string
  dataUrl: string
}

/** What an interaction is about, gathered before it is answered. */
export interface InteractionBackground {
  mentions: Lookup[]
  hashtags: Array<{ tag: string; recentPosts: Lookup[] }>
  quoted: Lookup | null
  thread: Lookup[]
  links: Array<{ url: string } & Lookup>
  images: Array<{ source: string; description: string; viewed: boolean }>
}

export interface InteractionLookupOptions {
  request: (method: HttpMethod, path: string) => Promise<unknown>
  /** The platform app's origin; links to it or its subdomains are followed. */
  appUrl: string | null
  /** The account answering, so its own handle is not looked up. */
  self: string | null
  /** Whether the model accepts images. */
  vision: boolean
  fetchImage?: (url: string) => Promise<Response>
}

/**
 * Background for an interaction: who it mentions, its hashtags, the Post it
 * quotes, the thread around a comment, links to this platform, and its
 * pictures. Every lookup is bounded and best effort; a lookup that fails is
 * left out rather than failing the answer.
 */
export class InteractionLookup {
  readonly #appHost: string | null

  constructor(private readonly options: InteractionLookupOptions) {
    this.#appHost = InteractionLookup.host(options.appUrl)
  }

  async gather(
    post: Lookup,
    comment: { id: string; text: string } | null,
    comments: unknown,
  ): Promise<{ background: InteractionBackground; images: LookupImage[] }> {
    const texts = [InteractionLookup.text(post.text), comment?.text ?? '']
    const quoted = InteractionLookup.record(post.originalPost)

    const [mentions, hashtags, links, images] = await Promise.all([
      this.mentions(post, texts),
      this.hashtags(post),
      this.links(post, texts),
      this.images(post, quoted),
    ])

    return {
      background: {
        mentions,
        hashtags,
        quoted: Object.keys(quoted).length ? InteractionLookup.postSummary(quoted) : null,
        thread: comment ? InteractionLookup.thread(comments, comment.id) : [],
        links,
        images: images.described,
      },
      images: images.viewed,
    }
  }

  private async mentions(post: Lookup, texts: string[]): Promise<Lookup[]> {
    const handles = new Set<string>()
    for (const handle of InteractionLookup.list(post.mentions)) handles.add(handle.toLowerCase())
    for (const text of texts) {
      for (const match of text.matchAll(/(?<![\w@])@([A-Za-z0-9_.]{2,30})/gu)) {
        handles.add(match[1]!.toLowerCase())
      }
    }
    if (this.options.self) handles.delete(this.options.self.toLowerCase())

    const found = await Promise.all(
      [...handles].slice(0, MAX_MENTIONS).map((handle) => this.profile(handle)),
    )

    return found.filter((entry): entry is Lookup => entry !== null)
  }

  private async hashtags(post: Lookup): Promise<InteractionBackground['hashtags']> {
    const tags = InteractionLookup.list(post.hashtags).slice(0, MAX_TAGS)

    return await Promise.all(
      tags.map(async (tag) => {
        const listed = await this.read(
          `/hashtags/${encodeURIComponent(tag)}/posts?page=1&per_page=${MAX_TAG_POSTS + 1}`,
        )
        const posts = Array.isArray(listed.data) ? listed.data : []

        return {
          tag,
          recentPosts: posts
            .map((entry) => InteractionLookup.record(entry))
            .filter((entry) => entry.slug !== post.slug)
            .slice(0, MAX_TAG_POSTS)
            .map((entry) => InteractionLookup.postSummary(entry)),
        }
      }),
    )
  }

  private async links(post: Lookup, texts: string[]): Promise<InteractionBackground['links']> {
    const urls = new Set<string>()
    const preview = InteractionLookup.record(post.linkPreview)
    if (typeof preview.url === 'string') urls.add(preview.url)
    for (const text of texts) {
      for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gu)) urls.add(match[0])
    }

    const own = [...urls].filter((url) => this.isAppLink(url)).slice(0, MAX_LINKS)
    const resolved = await Promise.all(own.map((url) => this.resolveLink(url)))

    return resolved.filter((entry): entry is { url: string } & Lookup => entry !== null)
  }

  private async resolveLink(url: string): Promise<({ url: string } & Lookup) | null> {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    const [first, second] = segments

    if (host !== this.#appHost) {
      const hall = host.slice(0, -(this.#appHost!.length + 1))
      const found = await this.read(`/halls/${encodeURIComponent(hall)}`)

      return Object.keys(found).length ? { url, hall: InteractionLookup.hallSummary(found) } : null
    }

    if (first === 'post' && second) {
      const found = InteractionLookup.record(
        (await this.read(`/posts/${encodeURIComponent(second)}`)).data,
      )

      return Object.keys(found).length ? { url, post: InteractionLookup.postSummary(found) } : null
    }
    if (first === 'tag' && second) return { url, hashtag: second }
    if (first === 'hall' && second) {
      const found = await this.read(`/halls/${encodeURIComponent(second)}`)

      return Object.keys(found).length ? { url, hall: InteractionLookup.hallSummary(found) } : null
    }
    if (first && segments.length === 1 && /^@?[A-Za-z0-9_.]{2,30}$/u.test(first)) {
      const profile = await this.profile(first.replace(/^@/u, ''))

      return profile ? { url, profile } : null
    }

    return null
  }

  private async images(
    post: Lookup,
    quoted: Lookup,
  ): Promise<{ described: InteractionBackground['images']; viewed: LookupImage[] }> {
    const candidates = [
      ...InteractionLookup.media(post.media, 'post'),
      ...InteractionLookup.media(quoted.media, 'quoted post'),
    ].slice(0, MAX_IMAGES)

    const viewed: LookupImage[] = []
    const described = await Promise.all(
      candidates.map(async (candidate) => {
        const dataUrl = this.options.vision ? await this.download(candidate.url) : null
        if (dataUrl) viewed.push({ ...candidate, dataUrl })

        return {
          source: candidate.source,
          description: candidate.description,
          viewed: Boolean(dataUrl),
        }
      }),
    )

    return { described, viewed }
  }

  /** An image as a data URL, or null when it cannot be read within bounds. */
  private async download(url: string): Promise<string | null> {
    try {
      if (new URL(url).protocol !== 'https:') return null

      const response = await (this.options.fetchImage ?? fetch)(url)
      const type = response.headers.get('Content-Type')?.split(';', 1)[0]?.toLowerCase() ?? ''
      if (!response.ok || !IMAGE_TYPES.has(type)) return null

      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength > MAX_IMAGE_BYTES) return null

      let binary = ''
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
      }

      return `data:${type};base64,${btoa(binary)}`
    } catch {
      return null
    }
  }

  private async profile(handle: string): Promise<Lookup | null> {
    const user = InteractionLookup.record(
      (await this.read(`/users/${encodeURIComponent(handle)}`)).data,
    )
    if (typeof user.username !== 'string') return null

    return {
      username: user.username,
      name: user.fullname ?? null,
      about: InteractionLookup.clip(user.about),
      isAgent: Boolean(user.isAgent),
      verified: Boolean(user.verified),
    }
  }

  private isAppLink(url: string): boolean {
    if (!this.#appHost) return false

    try {
      const parsed = new URL(url)
      const host = parsed.hostname.toLowerCase()

      return (
        (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
        (host === this.#appHost || host.endsWith(`.${this.#appHost}`))
      )
    } catch {
      return false
    }
  }

  /** A GET that yields an empty record instead of failing. */
  private async read(path: string): Promise<Lookup> {
    try {
      return InteractionLookup.record(await this.options.request('GET', path))
    } catch {
      return {}
    }
  }

  /** The comments around one: its parents and the latest others, oldest first. */
  private static thread(value: unknown, id: string): Lookup[] {
    const flat: Array<{ entry: Lookup; parent: string | null }> = []
    const walk = (items: unknown, parent: string | null) => {
      if (!Array.isArray(items)) return
      for (const item of items) {
        const entry = InteractionLookup.record(item)
        flat.push({ entry, parent })
        walk(entry.replies, String(entry.id))
      }
    }
    walk(value, null)

    const byId = new Map(flat.map((node) => [String(node.entry.id), node]))
    const ancestors: Lookup[] = []
    let parent = byId.get(id)?.parent ?? null
    while (parent && ancestors.length < MAX_THREAD) {
      const node = byId.get(parent)
      if (!node) break
      ancestors.unshift(node.entry)
      parent = node.parent
    }

    const room = MAX_THREAD - ancestors.length
    const others = room
      ? flat
          .map((node) => node.entry)
          .filter((entry) => String(entry.id) !== id && !ancestors.includes(entry))
          .slice(-room)
      : []

    const summary = (entry: Lookup) => {
      const replyTo = InteractionLookup.record(entry.replyTo)

      return {
        id: String(entry.id),
        author: InteractionLookup.author(entry.user),
        text: InteractionLookup.clip(entry.comment ?? entry.text),
        ...(typeof replyTo.username === 'string' ? { replyingTo: replyTo.username } : {}),
      }
    }

    return [
      ...ancestors.map((entry) => ({ ...summary(entry), inReplyChain: true })),
      ...others.map(summary),
    ]
  }

  private static postSummary(post: Lookup): Lookup {
    return {
      slug: post.slug ?? null,
      author: InteractionLookup.author(post.user),
      text: InteractionLookup.clip(post.text),
      hashtags: InteractionLookup.list(post.hashtags),
      media: InteractionLookup.media(post.media, 'post').map((item) => item.description),
      deleted: post.deleted === true ? true : undefined,
    }
  }

  private static hallSummary(response: Lookup): Lookup {
    const hall = InteractionLookup.record(response.data)

    return {
      slug: hall.slug ?? null,
      name: hall.name ?? null,
      description: InteractionLookup.clip(hall.description ?? hall.about),
    }
  }

  private static media(
    value: unknown,
    source: string,
  ): Array<{ source: string; description: string; url: string }> {
    if (!Array.isArray(value)) return []

    return value
      .map((item) => InteractionLookup.record(item))
      .filter((item) => String(item.mimetype ?? item.mimeType ?? '').startsWith('image/'))
      .map((item) => ({
        source,
        description:
          InteractionLookup.text(item.description) ||
          (item.kind === 'sticker' || item.kind === 'gif' ? `a ${String(item.kind)}` : 'an image'),
        url: InteractionLookup.text(item.thumbnail ?? item.previewUrl ?? item.mediaUrl ?? item.url),
      }))
      .filter((item) => item.url !== '')
  }

  private static author(value: unknown): string | null {
    const user = InteractionLookup.record(value)

    return typeof user.username === 'string' ? user.username : null
  }

  private static clip(value: unknown): string {
    return InteractionLookup.text(value).slice(0, MAX_TEXT)
  }

  private static list(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && item !== '')
      : []
  }

  private static text(value: unknown): string {
    return typeof value === 'string' ? value : ''
  }

  private static host(url: string | null): string | null {
    try {
      return url ? new URL(url).hostname.toLowerCase() : null
    } catch {
      return null
    }
  }

  private static record(value: unknown): Lookup {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Lookup)
      : {}
  }
}
