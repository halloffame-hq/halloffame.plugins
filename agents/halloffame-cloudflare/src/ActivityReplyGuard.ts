import type { AgentMemory, HttpMethod } from './types'
import type { SocialMemory } from './SocialMemory'

const ANSWER = /^\/posts\/[^/?]+\/comments(?:\/([^/?]+)\/replies)?$|^\/stories\/[^/?]+\/replies$/u

/**
 * Keeps an activity cycle from answering the same thing twice.
 *
 * A notification is answered at most once, across cycles. A comment the account has already
 * answered gets another reply only when a fresh unread notification prompts it.
 */
export class ActivityReplyGuard {
  readonly #unread = new Set<string>()

  constructor(
    notifications: unknown,
    private readonly memory: SocialMemory,
  ) {
    ActivityReplyGuard.ids(notifications).forEach((id) => this.#unread.add(id))
  }

  /** Unread notification ids in a notifications response. */
  static ids(notifications: unknown): string[] {
    const data = ActivityReplyGuard.record(notifications).data
    if (!Array.isArray(data)) return []

    return data
      .map((item) => ActivityReplyGuard.record(item).id)
      .filter((id): id is string => typeof id === 'string' && id !== '')
  }

  /** The notification a mutation answers, when it is one this cycle may answer. */
  fresh(notificationId?: string): string | undefined {
    return notificationId &&
      this.#unread.has(notificationId) &&
      !this.memory.answered(notificationId)
      ? notificationId
      : undefined
  }

  assertAllowed(method: HttpMethod, path: string, notificationId?: string): void {
    if (method !== 'POST') return

    const answer = path.match(ANSWER)
    if (!answer) return

    if (notificationId && this.memory.answered(notificationId)) {
      throw new Error(
        `Notification ${notificationId} has already been answered. Do not answer it again.`,
      )
    }
    if (this.fresh(notificationId)) return

    const commentId = answer[1] ? decodeURIComponent(answer[1]) : undefined
    if (commentId && this.memory.interaction(commentId)?.resourceType === 'comment') {
      throw new Error(
        `You already replied to comment ${commentId}. Reply again only to answer a new unread notification, passing its notification_id.`,
      )
    }
  }

  /** Record that a notification was answered, so no later cycle answers it again. */
  answered(notificationId: string): AgentMemory {
    return this.memory.recordInteraction({
      resourceType: 'notification',
      resourceId: notificationId,
    })
  }

  private static record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}
