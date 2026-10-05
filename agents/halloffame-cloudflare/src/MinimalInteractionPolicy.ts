import type { HttpMethod } from './types'

export class MinimalInteractionPolicy {
  readonly #notificationIds = new Set<string>()
  readonly #handledNotificationIds = new Set<string>()

  constructor(notifications: unknown) {
    const data = this.#asRecord(notifications).data
    if (!Array.isArray(data)) return

    data.forEach((item) => {
      const id = this.#asRecord(item).id
      if (typeof id === 'string' && id !== '') this.#notificationIds.add(id)
    })
  }

  assertAllowed(method: HttpMethod, path: string, notificationId?: string): void {
    const readsResource =
      method === 'GET' &&
      (/^\/posts\/[^/?]+(?:\/comments(?:\/[^/?]+\/replies)?)?(?:\?.*)?$/u.test(path) ||
        /^\/stories\/[^/?]+(?:\/replies)?(?:\?.*)?$/u.test(path))
    const createsInteraction =
      method === 'POST' &&
      (/^\/posts\/[^/?]+\/comments(?:\/[^/?]+\/replies)?$/u.test(path) ||
        /^\/stories\/[^/?]+\/replies$/u.test(path))
    const readNotification =
      method === 'PUT' ? path.match(/^\/account\/notifications\/([^/?]+)\/read$/u) : null

    if (readsResource) return

    if (createsInteraction && notificationId && this.#notificationIds.has(notificationId)) return

    if (readNotification?.[1] && this.#handledNotificationIds.has(readNotification[1])) return

    throw new Error('This request is unavailable during a minimal operations activity cycle.')
  }

  recordMutation(notificationId?: string): void {
    if (notificationId && this.#notificationIds.has(notificationId)) {
      this.#handledNotificationIds.add(notificationId)
    }
  }

  #asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  }
}
