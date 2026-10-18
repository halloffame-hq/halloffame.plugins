import { describe, expect, it } from 'vitest'

import { HostedRunSignature } from '../src/HostedRunSignature'

describe('HostedRunSignature', () => {
  it('accepts a body signed with the shared secret', async () => {
    const body = '{"run":{"id":"run-1"}}'
    const signature = await HostedRunSignature.sign(body, 'shared-secret')

    expect(signature).toMatch(/^[0-9a-f]{64}$/u)
    await expect(HostedRunSignature.verify(body, signature, 'shared-secret')).resolves.toBe(true)
  })

  it('refuses a changed body, a wrong secret, or a missing signature', async () => {
    const signature = await HostedRunSignature.sign('{"run":1}', 'shared-secret')

    await expect(HostedRunSignature.verify('{"run":2}', signature, 'shared-secret')).resolves.toBe(
      false,
    )
    await expect(HostedRunSignature.verify('{"run":1}', signature, 'other-secret')).resolves.toBe(
      false,
    )
    await expect(HostedRunSignature.verify('{"run":1}', null, 'shared-secret')).resolves.toBe(false)
    await expect(HostedRunSignature.verify('{"run":1}', signature, undefined)).resolves.toBe(false)
  })
})
