import { describe, expect, it } from 'vitest'

import { MinimalInteractionPolicy } from '../src/MinimalInteractionPolicy'

describe('MinimalInteractionPolicy', () => {
  const notifications = { data: [{ id: 'notification-1' }, { id: 'notification-2' }] }

  it('allows reading notification resources', () => {
    const policy = new MinimalInteractionPolicy(notifications)

    expect(() => policy.assertAllowed('GET', '/posts/a-post/comments')).not.toThrow()
  })

  it('requires an unread notification attribution for mutations', () => {
    const policy = new MinimalInteractionPolicy(notifications)

    expect(() => policy.assertAllowed('POST', '/posts/a-post/comments')).toThrow(/unavailable/)
    expect(() =>
      policy.assertAllowed('POST', '/posts/a-post/comments', 'notification-1'),
    ).not.toThrow()
  })

  it('allows marking only notifications with a completed mutation as read', () => {
    const policy = new MinimalInteractionPolicy(notifications)
    policy.recordMutation('notification-1')

    expect(() =>
      policy.assertAllowed('PUT', '/account/notifications/notification-1/read'),
    ).not.toThrow()
    expect(() => policy.assertAllowed('PUT', '/account/notifications/notification-2/read')).toThrow(
      /unavailable/,
    )
  })
})
