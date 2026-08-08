import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import { createPayoutProvider, PaystackPayoutProvider } from '../src/index.js'

const client = () => ({
  misc: {
    banks: vi.fn(),
  },
  recipient: {
    create: vi.fn(),
    fetch: vi.fn(),
  },
  transfer: {
    initiate: vi.fn(),
    fetch: vi.fn(),
  },
})

const recipient = {
  ownerType: 'Hall',
  ownerId: 'hall-1',
  name: 'Ledger Hall',
  email: 'organiser@example.com',
  currency: 'NGN',
  details: {
    account_name: 'Ledger Hall Ltd',
    account_number: '0123456789',
    bank_code: '058',
  },
}

const signed = (secret: string, body: string) => ({
  'x-paystack-signature': createHmac('sha512', secret).update(body).digest('hex'),
})

describe('Paystack payout provider', () => {
  it('creates a recipient from the bank details it collects', async () => {
    const sdk = client()
    sdk.recipient.create.mockResolvedValue({
      status: true,
      message: 'ok',
      data: {
        recipient_code: 'RCP_123',
        details: { account_number: '0123456789', bank_name: 'GTBank' },
      },
    })

    const result = await new PaystackPayoutProvider(sdk, 'secret').createRecipient(recipient)

    expect(sdk.recipient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'nuban',
        account_number: '0123456789',
        bank_code: '058',
        currency: 'NGN',
      }),
    )
    // Paystack resolves the account as it creates the recipient, so one that
    // comes back at all is payable and there is nothing to onboard.
    expect(result).toMatchObject({
      recipientId: 'RCP_123',
      status: 'verified',
      bankName: 'GTBank',
      last4: '6789',
    })
    expect(result.onboardingUrl).toBeUndefined()
  })

  describe('the bank list', () => {
    it('offers active banks, named and in order', async () => {
      const sdk = client()
      sdk.misc.banks.mockResolvedValue({
        status: true,
        message: 'ok',
        data: [
          { name: 'Zenith Bank', code: '057', active: true },
          { name: 'Access Bank', code: '044', active: true },
          { name: 'Defunct Bank', code: '000', active: false },
        ],
      })

      const options = await new PaystackPayoutProvider(sdk, 'secret').fieldOptions('bank_code')

      // Sorted, because a few hundred banks in the API's own order is a list
      // nobody can use, and inactive ones would refuse the transfer anyway.
      expect(options).toEqual([
        { value: '044', label: 'Access Bank' },
        { value: '057', label: 'Zenith Bank' },
      ])
    })

    it('asks for the currency being paid in', async () => {
      const sdk = client()
      sdk.misc.banks.mockResolvedValue({ status: true, message: 'ok', data: [] })

      await new PaystackPayoutProvider(sdk, 'secret').fieldOptions('bank_code', 'GHS')

      expect(sdk.misc.banks).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'GHS' }),
      )
    })

    it('has nothing to offer for any other field', async () => {
      const sdk = client()

      expect(
        await new PaystackPayoutProvider(sdk, 'secret').fieldOptions('account_number'),
      ).toEqual([])
      expect(sdk.misc.banks).not.toHaveBeenCalled()
    })

    it('returns nothing rather than throwing when Paystack refuses', async () => {
      const sdk = client()
      sdk.misc.banks.mockResolvedValue({ status: false, message: 'nope', data: null })

      expect(
        await new PaystackPayoutProvider(sdk, 'secret').fieldOptions('bank_code'),
      ).toEqual([])
    })
  })

  it('describes the fields it needs, so a client can render them', () => {
    const provider = new PaystackPayoutProvider(client(), 'secret')

    expect(provider.onboarding).toBe('fields')
    expect(provider.recipientFields.map((field) => field.key)).toEqual([
      'account_name',
      'account_number',
      'bank_code',
    ])
  })

  it('sends the idempotency key as the reference a duplicate is refused on', async () => {
    const sdk = client()
    sdk.transfer.initiate.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { transfer_code: 'TRF_1', status: 'pending' },
    })

    await new PaystackPayoutProvider(sdk, 'secret').transfer({
      payoutId: 'payout-1',
      recipientId: 'RCP_123',
      amountMinor: 250_000,
      currency: 'NGN',
      reference: 'payout_ref',
      idempotencyKey: 'payout_idem_1',
    })

    expect(sdk.transfer.initiate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'balance',
        amount: 250_000,
        recipient: 'RCP_123',
        reference: 'payout_idem_1',
      }),
    )
  })

  it('never reports a freshly initiated transfer as paid', async () => {
    const sdk = client()
    sdk.transfer.initiate.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { transfer_code: 'TRF_1', status: 'pending' },
    })

    const result = await new PaystackPayoutProvider(sdk, 'secret').transfer({
      payoutId: 'payout-1',
      recipientId: 'RCP_123',
      amountMinor: 1_000,
      currency: 'NGN',
      reference: 'payout_ref',
      idempotencyKey: 'payout_idem_2',
    })

    expect(result.status).toBe('pending')
  })

  it('treats a transfer waiting on an OTP as pending, not failed', async () => {
    const sdk = client()
    sdk.transfer.initiate.mockResolvedValue({
      status: true,
      message: 'ok',
      data: { transfer_code: 'TRF_2', status: 'otp' },
    })

    const result = await new PaystackPayoutProvider(sdk, 'secret').transfer({
      payoutId: 'payout-2',
      recipientId: 'RCP_123',
      amountMinor: 1_000,
      currency: 'NGN',
      reference: 'payout_ref',
      idempotencyKey: 'payout_idem_3',
    })

    expect(result.status).toBe('pending')
  })

  it('reports a refused transfer as failed, with the reason', async () => {
    const sdk = client()
    sdk.transfer.initiate.mockResolvedValue({
      status: false,
      message: 'Insufficient balance',
      data: null,
    })

    const result = await new PaystackPayoutProvider(sdk, 'secret').transfer({
      payoutId: 'payout-3',
      recipientId: 'RCP_123',
      amountMinor: 1_000,
      currency: 'NGN',
      reference: 'payout_ref',
      idempotencyKey: 'payout_idem_4',
    })

    expect(result).toMatchObject({ status: 'failed', failureReason: 'Insufficient balance' })
  })

  describe('webhooks', () => {
    const provider = new PaystackPayoutProvider(client(), 'secret')

    it('refuses a body that is not signed', async () => {
      const body = JSON.stringify({ event: 'transfer.success', data: { transfer_code: 'TRF_1' } })

      expect(await provider.parseWebhook(body, {})).toBeNull()
      expect(await provider.parseWebhook(body, { 'x-paystack-signature': 'nonsense' })).toBeNull()
    })

    it('reads a successful transfer', async () => {
      const body = JSON.stringify({
        event: 'transfer.success',
        data: { id: 9, transfer_code: 'TRF_1', reference: 'payout_idem_1' },
      })

      expect(await provider.parseWebhook(body, signed('secret', body))).toMatchObject({
        type: 'transfer.success',
        transferId: 'TRF_1',
        reference: 'payout_idem_1',
        status: 'paid',
      })
    })

    it('treats a reversal as a failure, since the money came back', async () => {
      const body = JSON.stringify({
        event: 'transfer.reversed',
        data: { id: 10, transfer_code: 'TRF_2', reason: 'Account closed' },
      })

      expect(await provider.parseWebhook(body, signed('secret', body))).toMatchObject({
        status: 'failed',
        failureReason: 'Account closed',
      })
    })

    it('ignores a payment webhook, which is the other provider’s business', async () => {
      const body = JSON.stringify({ event: 'charge.success', data: { id: 1 } })

      expect(await provider.parseWebhook(body, signed('secret', body))).toBeNull()
    })
  })

  it('requires a secret key', () => {
    expect(() => createPayoutProvider({ secretKey: '' })).toThrow(/PAYSTACK_SECRET_KEY/)
  })
})
