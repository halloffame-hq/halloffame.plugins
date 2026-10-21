import { describe, expect, it } from 'vitest'

import { ActivityReplyGuard } from '../src/ActivityReplyGuard'
import { SocialMemory } from '../src/SocialMemory'

describe('ActivityReplyGuard', () => {
  const unread = { data: [{ id: 'notification-1' }, { id: 'notification-2' }] }
  const reply = '/posts/a-post/comments/comment-1/replies'

  it('answers a notification once, across cycles', () => {
    const memory = new SocialMemory()
    const guard = new ActivityReplyGuard(unread, memory)

    expect(guard.fresh('notification-1')).toBe('notification-1')
    expect(() => guard.assertAllowed('POST', reply, 'notification-1')).not.toThrow()
    guard.answered('notification-1')

    const nextCycle = new ActivityReplyGuard(unread, memory)
    expect(nextCycle.fresh('notification-1')).toBeUndefined()
    expect(() => nextCycle.assertAllowed('POST', reply, 'notification-1')).toThrow(
      /already been answered/,
    )
  })

  it('replies to an answered comment again only for a new unread notification', () => {
    const memory = new SocialMemory()
    memory.recordInteraction({ resourceType: 'comment', resourceId: 'comment-1' })
    const guard = new ActivityReplyGuard(unread, memory)

    expect(() => guard.assertAllowed('POST', reply)).toThrow(/already replied to comment comment-1/)
    expect(() => guard.assertAllowed('POST', reply, 'not-unread')).toThrow(/already replied/)
    expect(() => guard.assertAllowed('POST', reply, 'notification-2')).not.toThrow()
  })

  it('leaves reads, other comments, and other routes alone', () => {
    const memory = new SocialMemory()
    memory.recordInteraction({ resourceType: 'comment', resourceId: 'comment-1' })
    const guard = new ActivityReplyGuard(unread, memory)

    expect(() => guard.assertAllowed('GET', '/posts/a-post/comments')).not.toThrow()
    expect(() =>
      guard.assertAllowed('POST', '/posts/a-post/comments/comment-2/replies'),
    ).not.toThrow()
    expect(() => guard.assertAllowed('POST', '/posts/a-post/reactions')).not.toThrow()
  })
})
