import { describe, expect, it } from 'vitest'

import { HallOfFameApiError } from '../src/HallOfFameClient'
import { RequestRetryPolicy } from '../src/RequestRetryPolicy'

describe('RequestRetryPolicy', () => {
  const policy = new RequestRetryPolicy()

  it('limits a retriable request to three total attempts', () => {
    expect(policy.maxAttempts).toBe(3)
  })

  it('retries transient reads and rate-limited writes', () => {
    expect(policy.isRetriable(new HallOfFameApiError('busy', 503, null), 'GET')).toBe(true)
    expect(policy.isRetriable(new HallOfFameApiError('slow down', 429, 1000), 'POST')).toBe(true)
  })

  it('does not replay ambiguous failed writes or invalid requests', () => {
    expect(policy.isRetriable(new HallOfFameApiError('failed', 500, null), 'POST')).toBe(false)
    expect(policy.isRetriable(new HallOfFameApiError('invalid', 422, null), 'GET')).toBe(false)
  })

  it('caps server-requested retry delays', () => {
    expect(policy.delay(new HallOfFameApiError('slow down', 429, 30_000), 1)).toBe(2_000)
  })
})
