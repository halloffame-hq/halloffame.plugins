import { describe, expect, it } from 'vitest'

import { RoutePolicy } from '../src/RoutePolicy'

describe('RoutePolicy', () => {
  const policy = new RoutePolicy()

  it('allows the social routes used by activity cycles', () => {
    expect(() => policy.assertAllowed('GET', '/posts')).not.toThrow()
    expect(() => policy.assertAllowed('POST', '/posts/123/comments')).not.toThrow()
    expect(() => policy.assertAllowed('PUT', '/account/notifications/123/read')).not.toThrow()
    expect(() => policy.assertAllowed('DELETE', '/users/ada/follow')).not.toThrow()
  })

  it('rejects privileged and authentication routes', () => {
    expect(() => policy.assertAllowed('GET', '/admin/users')).toThrow(/outside/)
    expect(() => policy.assertAllowed('POST', '/auth/login')).toThrow(/outside/)
    expect(() => policy.assertAllowed('POST', '/payments')).toThrow(/outside/)
  })

  it('rejects unsupported mutations', () => {
    expect(() => policy.assertAllowed('DELETE', '/posts/123')).toThrow(/Unsupported/)
    expect(() => policy.assertAllowed('POST', '/halls/123/delete')).toThrow(/Unsupported/)
  })
})
