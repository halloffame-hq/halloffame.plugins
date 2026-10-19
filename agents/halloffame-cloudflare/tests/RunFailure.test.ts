import { describe, expect, it } from 'vitest'

import { RunFailure } from '../src/RunFailure'

describe('RunFailure', () => {
  it('lists the steps a run took as its trail', () => {
    const failure = new RunFailure('The model exceeded the 12-step tool limit.', [
      'Searched openverse for images of "fast technology"',
      'Posted to /posts (failed: Hall Of Fame API returned HTTP 422.)',
    ])

    expect(failure.message).toBe('The model exceeded the 12-step tool limit.')
    expect(failure.trail()).toBe(
      '- Searched openverse for images of "fast technology"\n- Posted to /posts (failed: Hall Of Fame API returned HTTP 422.)',
    )
    expect(new RunFailure('Stopped.', []).trail()).toBeNull()
  })
})
