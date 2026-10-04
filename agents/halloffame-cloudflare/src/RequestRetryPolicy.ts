import { HallOfFameApiError } from './HallOfFameClient'
import type { HttpMethod } from './types'

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])

export class RequestRetryPolicy {
  readonly maxAttempts = 3

  isRetriable(error: unknown, method: HttpMethod): boolean {
    if (error instanceof HallOfFameApiError) {
      if (!TRANSIENT_STATUSES.has(error.status)) return false

      return method === 'GET' || method === 'PUT' || method === 'DELETE' || error.status === 429
    }

    return method === 'GET' && error instanceof TypeError
  }

  delay(error: unknown, attempt: number): number {
    const retryAfter = error instanceof HallOfFameApiError ? error.retryAfterMs : null

    return Math.min(retryAfter ?? 250 * 2 ** (attempt - 1), 2_000)
  }
}
