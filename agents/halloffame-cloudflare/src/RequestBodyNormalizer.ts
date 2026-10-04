export class RequestBodyNormalizer {
  normalize(path: string, body: unknown): unknown {
    if (!this.isCommentRoute(path)) return body

    const value = this.record(body)
    if (typeof value.comment === 'string' && value.comment.trim()) return body

    const comment = [value.text, value.content, value.reply].find(
      (candidate) => typeof candidate === 'string' && candidate.trim() !== '',
    )
    if (typeof comment !== 'string') return body

    const { text: _text, content: _content, reply: _reply, ...rest } = value

    return { ...rest, comment }
  }

  private isCommentRoute(path: string): boolean {
    return (
      /^\/posts\/[^/]+\/comments(?:\/[^/]+\/replies)?(?:\?.*)?$/u.test(path) ||
      /^\/stories\/[^/]+\/replies(?:\?.*)?$/u.test(path)
    )
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}
