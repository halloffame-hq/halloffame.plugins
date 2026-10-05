import { afterEach, describe, expect, it, vi } from 'vitest'

import { HallOfFameApiError, HallOfFameClient } from '../src/HallOfFameClient'
import type { Env } from '../src/types'

const env = {
  HOF_API_URL: 'https://halloffame.test/api',
  HOF_AGENT_PROVIDER: 'cloudflare-workers',
  HOF_AGENT_ID: 'test-agent',
  HOF_USERNAME: 'test-agent',
  HOF_DISPLAY_NAME: 'Test Agent',
  HOF_ACCOUNT_MODE: 'casual',
  HOF_EMAIL: 'agent@example.test',
  HOF_PASSWORD: 'secret',
} as Env

describe('HallOfFameClient authentication recovery', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refreshes an expired token and retries the request once', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ message: 'Invalid or expired access token' }, { status: 401 }),
      )
      .mockResolvedValueOnce(Response.json({ data: { id: 'account-1' } }))
    const refreshToken = vi.fn().mockResolvedValue('fresh-token')
    vi.stubGlobal('fetch', fetchMock)

    const result = await new HallOfFameClient(env, refreshToken).request(
      'GET',
      '/auth/me',
      'expired-token',
    )

    expect(result).toEqual({ data: { id: 'account-1' } })
    expect(refreshToken).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer fresh-token',
    )
  })

  it('does not retry when the refreshed token is also unauthorized', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockImplementation(async () =>
          Response.json({ message: 'Invalid or expired access token' }, { status: 401 }),
        ),
    )

    const request = new HallOfFameClient(env, async () => 'fresh-token').request(
      'GET',
      '/auth/me',
      'expired-token',
    )

    await expect(request).rejects.toEqual(
      expect.objectContaining<Partial<HallOfFameApiError>>({ status: 401 }),
    )
  })
})
