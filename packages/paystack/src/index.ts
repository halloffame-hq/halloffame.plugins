import type { PaymentProvider, PaystackClient, PaystackProviderOptions } from './types'
import type { PaystackPayoutClient, PaystackPayoutOptions, PayoutProvider } from './payout-types'

import { Paystack } from 'paystack-sdk'
import { PaystackPayoutProvider } from './PaystackPayoutProvider'
import { PaystackProvider } from './PaystackProvider'

const required = (value: string | undefined, name: string): string => {
  if (!value?.trim()) throw new Error(`${name} is required to use the Paystack payment provider.`)

  return value.trim()
}

export function createPaymentProvider(options: PaystackProviderOptions = {}): PaymentProvider {
  const secretKey = required(
    options.secretKey ?? process.env.PAYSTACK_SECRET_KEY,
    'PAYSTACK_SECRET_KEY',
  )
  const client = options.client ?? (new Paystack(secretKey) as unknown as PaystackClient)

  return new PaystackProvider(
    client,
    secretKey,
    options.callbackUrl ?? process.env.PAYSTACK_CALLBACK_URL,
  )
}

/**
 * Paying out through Paystack Transfers.
 *
 * A separate factory from the payment one, and a separate export, because
 * taking money with one provider and paying out with another is a normal
 * arrangement that a single entry point would rule out.
 */
export function createPayoutProvider(options: PaystackPayoutOptions = {}): PayoutProvider {
  const secretKey = required(
    options.secretKey ?? process.env.PAYSTACK_SECRET_KEY,
    'PAYSTACK_SECRET_KEY',
  )
  const client = options.client ?? (new Paystack(secretKey) as unknown as PaystackPayoutClient)

  return new PaystackPayoutProvider(client, secretKey, options.recipientType)
}

export { PaystackProvider } from './PaystackProvider.js'
export { PaystackPayoutProvider } from './PaystackPayoutProvider.js'
export * from './types.js'
export * from './payout-types.js'
export default createPaymentProvider
