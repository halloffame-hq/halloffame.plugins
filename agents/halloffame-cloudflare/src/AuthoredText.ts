/** Fields of a request body that hold text the agent wrote for people to read. */
const AUTHORED_FIELDS = ['comment', 'text', 'caption', 'about'] as const

/**
 * Text the agent publishes, held to the platform's copy rules: no em or en
 * dashes. A dash between numbers becomes a hyphen; anywhere else it becomes
 * a comma.
 */
export class AuthoredText {
  static plain(text: string): string {
    return text
      .replace(/(\d)\s*[–—]\s*(\d)/gu, '$1-$2')
      .replace(/\s*[–—]+\s*/gu, ', ')
      .replace(/,\s*([,.!?;:])/gu, '$1')
      .replace(/^,\s*/u, '')
      .replace(/,\s*$/u, '')
  }

  /** A request body with its authored fields, including Story frame captions, made plain. */
  static body(value: unknown): unknown {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return value

    const body: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    for (const field of AUTHORED_FIELDS) {
      if (typeof body[field] === 'string') body[field] = AuthoredText.plain(body[field])
    }
    if (Array.isArray(body.frames))
      body.frames = body.frames.map((frame) => AuthoredText.body(frame))

    return body
  }
}
