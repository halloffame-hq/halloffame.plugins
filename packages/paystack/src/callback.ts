import type {
  PaymentCallback,
  PaymentCallbackListenerOptions,
  PaymentVerification,
} from './client-types'

export const PAYSTACK_CALLBACK_QUERY = 'hof_payment_callback'
const CALLBACK_STORAGE_PREFIX = 'hof.payment.callback.'

const browserStorage = (): Storage | undefined =>
  typeof window === 'undefined' ? undefined : window.sessionStorage

export function createPaystackCallbackUrl(
  baseUrl: string,
  storage: Pick<Storage, 'setItem'> | undefined = browserStorage(),
): string {
  const url = new URL(baseUrl)
  const token = crypto.randomUUID()
  url.searchParams.set(PAYSTACK_CALLBACK_QUERY, token)
  url.searchParams.delete('reference')
  storage?.setItem(`${CALLBACK_STORAGE_PREFIX}${token}`, 'pending')

  return url.toString()
}

export function paymentCallbackFromUrl(
  value: string,
  storage: Pick<Storage, 'getItem'> | undefined = browserStorage(),
): PaymentCallback | null {
  const url = new URL(value)
  const token = url.searchParams.get(PAYSTACK_CALLBACK_QUERY)
  const reference = url.searchParams.get('reference') ?? url.searchParams.get('trxref')
  if (!token || !reference) return null
  if (storage && storage.getItem(`${CALLBACK_STORAGE_PREFIX}${token}`) !== 'pending') return null

  return { token, reference, url }
}

export function listenForPaystackCallback(options: PaymentCallbackListenerOptions): () => void {
  const currentUrl = options.currentUrl ?? (() => window.location.href)
  const eventTarget = options.eventTarget ?? window
  const history = options.history ?? window.history
  const storage = options.storage ?? browserStorage()
  let processing: string | null = null

  const check = async () => {
    const callback = paymentCallbackFromUrl(currentUrl(), storage)
    if (!callback || processing === callback.token) return
    processing = callback.token

    try {
      const verification: PaymentVerification = await options.verify(callback.reference)
      storage?.removeItem(`${CALLBACK_STORAGE_PREFIX}${callback.token}`)
      callback.url.searchParams.delete(PAYSTACK_CALLBACK_QUERY)
      callback.url.searchParams.delete('reference')
      callback.url.searchParams.delete('trxref')
      history.replaceState(null, '', callback.url.toString())
      options.onVerified?.(verification, callback)
    } catch (error) {
      processing = null
      options.onError?.(error as Error)
    }
  }

  const listener = () => void check()
  eventTarget.addEventListener('popstate', listener)
  eventTarget.addEventListener('hashchange', listener)
  void check()

  return () => {
    eventTarget.removeEventListener('popstate', listener)
    eventTarget.removeEventListener('hashchange', listener)
  }
}
