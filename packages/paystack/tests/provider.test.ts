import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { createPaymentProvider, PaystackProvider } from '../src/index.js'

const client = () => ({
  transaction: {
    initialize: vi.fn(),
    verify: vi.fn(),
    chargeAuthorization: vi.fn(),
  },
  refund: {
    create: vi.fn(),
  },
})

const checkout = {
  invoiceId: 'invoice-1',
  reference: 'hof_reference',
  amountMinor: 500_000,
  currency: 'NGN',
  customerEmail: 'payer@example.com',
  callbackUrl: 'https://app.example.com/account/settings/billing?hof_payment_callback=nonce',
  subjectType: 'User',
  subjectId: 'user-1',
}

describe('Paystack payment provider', () => {
  it('initializes hosted checkout in minor units', async () => {
    const sdk = client()
    sdk.transaction.initialize.mockResolvedValue({
      status: true,
      message: 'ok',
      data: {
        reference: checkout.reference,
        authorization_url: 'https://checkout.paystack.com/example',
        access_code: 'access_code',
      },
    })
    const provider = createPaymentProvider({
      secretKey: 'secret',
      client: sdk,
    })

    expect(provider).toBeInstanceOf(PaystackProvider)
    await expect(provider.createCheckout(checkout)).resolves.toEqual({
      reference: checkout.reference,
      redirectUrl: 'https://checkout.paystack.com/example',
      status: 'pending',
      client: {
        provider: 'paystack',
        token: 'access_code',
      },
    })
    expect(sdk.transaction.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: '500000',
        email: checkout.customerEmail,
        currency: 'NGN',
        callback_url: 'https://app.example.com/account/settings/billing?hof_payment_callback=nonce',
      }),
    )
  })

  it('maps verification and reusable authorization charges', async () => {
    const sdk = client()
    sdk.transaction.verify.mockResolvedValue({
      status: true,
      message: 'ok',
      data: {
        id: 1,
        amount: 500_000,
        currency: 'NGN',
        status: 'success',
        reference: checkout.reference,
        paid_at: '2026-07-27T12:00:00.000Z',
      },
    })
    sdk.transaction.chargeAuthorization.mockResolvedValue({
      status: true,
      message: 'ok',
      data: {
        id: 2,
        amount: 500_000,
        currency: 'NGN',
        status: 'success',
        reference: checkout.reference,
      },
    })
    const provider = createPaymentProvider({
      secretKey: 'secret',
      client: sdk,
    })

    await expect(provider.verify(checkout.reference)).resolves.toMatchObject({
      status: 'paid',
      amountMinor: 500_000,
      currency: 'NGN',
    })
    await expect(provider.chargePaymentMethod(checkout, 'AUTH_reusable')).resolves.toMatchObject({
      status: 'paid',
    })
  })

  it('authenticates webhooks and extracts a reusable payment method', async () => {
    const sdk = client()
    const secretKey = 'webhook-secret'
    const rawBody = JSON.stringify({
      event: 'charge.success',
      data: {
        id: 42,
        amount: 500_000,
        currency: 'NGN',
        reference: checkout.reference,
        customer: { email: checkout.customerEmail },
        authorization: {
          authorization_code: 'AUTH_reusable',
          signature: 'SIG_card',
          channel: 'card',
          brand: 'visa',
          last4: '4081',
          reusable: true,
        },
      },
    })
    const signature = createHmac('sha512', secretKey).update(rawBody).digest('hex')
    const provider = createPaymentProvider({ secretKey, client: sdk })

    await expect(
      provider.parseWebhook(rawBody, { 'x-paystack-signature': signature }),
    ).resolves.toMatchObject({
      eventId: 'charge.success:42',
      status: 'paid',
      amountMinor: 500_000,
      paymentMethod: {
        providerMethodId: 'AUTH_reusable',
        signature: 'SIG_card',
        last4: '4081',
        reusable: true,
      },
    })
    await expect(
      provider.parseWebhook(rawBody, { 'x-paystack-signature': 'invalid' }),
    ).resolves.toBeNull()
  })

  it('initiates refunds through the SDK', async () => {
    const sdk = client()
    sdk.refund.create.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { status: 'pending' },
    })
    const provider = createPaymentProvider({
      secretKey: 'secret',
      client: sdk,
    })

    await expect(provider.refund(checkout.reference, 250_000)).resolves.toEqual({
      status: 'pending',
    })
    expect(sdk.refund.create).toHaveBeenCalledWith({
      transaction: checkout.reference,
      amount: 250_000,
    })
  })
})
