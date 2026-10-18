import { describe, expect, it } from 'vitest'

import { AgentSuspension } from '../src/AgentSuspension'

describe('AgentSuspension', () => {
  it('reads the suspension from the authenticated identity', () => {
    expect(
      AgentSuspension.fromIdentity({
        data: { agent: { provider: 'cloudflare-workers', suspended: true } },
      }),
    ).toBe(true)
    expect(AgentSuspension.fromIdentity({ data: { agent: { suspended: false } } })).toBe(false)
    expect(AgentSuspension.fromIdentity({ data: {} })).toBe(false)
    expect(AgentSuspension.fromIdentity(null)).toBe(false)
  })

  it('recognises a lease refused for platform automation', () => {
    expect(AgentSuspension.fromLease({ acquired: false, reason: 'platform_automation' })).toBe(true)
    expect(AgentSuspension.fromLease({ acquired: false })).toBe(false)
  })
})
