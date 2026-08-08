import type {
  PaystackPayoutClient,
  PayoutProvider,
  PayoutRecipientInput,
  PayoutFieldOption,
  PayoutRecipientResult,
  PayoutRecipientStatus,
  PayoutTransferInput,
  PayoutTransferResult,
  PayoutWebhookResult,
} from './payout-types'

import { verifyPaystackSignature } from './webhook'

/**
 * Paying organisers out through Paystack Transfers.
 *
 * Paystack is a `fields` provider: it is given the bank details and validates
 * them itself, so a recipient is usable as soon as it is created and there is
 * no hosted onboarding to send anyone to. A provider that works the other way
 * round, such as Stripe Connect, returns `pending` and an onboarding URL
 * instead, which is why the contract carries both.
 *
 * A transfer is never `paid` on the response to initiating it. Paystack returns
 * `pending`, or `otp` when the account requires one, and the outcome arrives by
 * webhook. Treating the initiation response as success would mark money sent
 * that a bank may still reject.
 */
export class PaystackPayoutProvider implements PayoutProvider {
  readonly name = 'paystack'
  readonly label = 'Paystack Transfers'
  readonly onboarding = 'fields' as const
  readonly requiresRecipient = true
  readonly recipientFields = [
    { key: 'account_name', label: 'Account name', required: true },
    {
      key: 'account_number',
      label: 'Account number',
      help: 'The 10-digit NUBAN for a Nigerian account.',
      required: true,
    },
    {
      key: 'bank_code',
      label: 'Bank',
      help: 'The bank the account is held at.',
      required: true,
      // Paystack owns this list, it is long, and it changes without warning.
      // A code typed by hand is a transfer that fails at the bank rather than
      // at the form.
      optionsFromProvider: true,
    },
  ]

  constructor(
    private readonly client: PaystackPayoutClient,
    private readonly secretKey: string,
    private readonly recipientType = 'nuban',
  ) {}

  async createRecipient(input: PayoutRecipientInput): Promise<PayoutRecipientResult> {
    const response = await this.client.recipient.create({
      type: this.recipientType,
      name: input.details.account_name?.trim() || input.name,
      account_number: input.details.account_number,
      bank_code: input.details.bank_code,
      currency: input.currency,
      email: input.email,
      description: `${input.ownerType} ${input.ownerId}`,
    })
    if (!response.status || !response.data) throw new Error(response.message)

    return {
      recipientId: response.data.recipient_code,
      // Paystack resolves the account against the bank as it creates the
      // recipient, so one that comes back at all is payable.
      status: 'verified',
      bankName: response.data.details?.bank_name ?? null,
      last4: response.data.details?.account_number?.slice(-4) ?? null,
    }
  }

  /**
   * The banks Paystack will pay into, for the currency being paid in.
   *
   * Sorted by name because the API returns them in its own order, and a few
   * hundred banks in no particular order is a list nobody can use. Inactive
   * ones are dropped: offering a bank that will refuse the transfer is worse
   * than not offering it.
   */
  async fieldOptions(key: string, currency = 'NGN'): Promise<PayoutFieldOption[]> {
    if (key !== 'bank_code' || !this.client.misc) return []

    const response = await this.client.misc.banks({ currency, perPage: 100 })
    if (!response.status || !response.data) return []

    return response.data
      .filter((bank) => bank.active !== false)
      .map((bank) => ({ value: bank.code, label: bank.name }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }

  async recipientStatus(recipientId: string): Promise<PayoutRecipientStatus> {
    const response = await this.client.recipient.fetch(recipientId)

    return response.status && response.data ? 'verified' : 'rejected'
  }

  async transfer(input: PayoutTransferInput): Promise<PayoutTransferResult> {
    const response = await this.client.transfer.initiate({
      source: 'balance',
      amount: input.amountMinor,
      recipient: input.recipientId,
      currency: input.currency,
      reason: input.reason ?? 'Payout',
      /*
       * Paystack has no idempotency header, but it rejects a duplicate
       * reference, which achieves the same thing: a retry after a timeout is
       * refused rather than sent twice.
       */
      reference: input.idempotencyKey,
    })
    if (!response.status || !response.data) {
      return { transferId: '', status: 'failed', failureReason: response.message }
    }

    return {
      transferId: response.data.transfer_code,
      status: transferStatusFrom(response.data.status),
      failureReason: null,
    }
  }

  async transferStatus(transferId: string): Promise<PayoutTransferResult> {
    const response = await this.client.transfer.fetch(transferId)
    if (!response.status || !response.data) {
      return { transferId, status: 'failed', failureReason: response.message }
    }

    return {
      transferId: response.data.transfer_code ?? transferId,
      status: transferStatusFrom(response.data.status),
      failureReason: null,
    }
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<PayoutWebhookResult | null> {
    if (!verifyPaystackSignature(this.secretKey, rawBody, headers)) return null

    const payload = JSON.parse(rawBody) as {
      event?: string
      data?: {
        id?: number | string
        transfer_code?: string
        reference?: string
        status?: string
        reason?: string
      }
    }
    const event = payload.event ?? 'unknown'
    if (!event.startsWith('transfer.')) return null

    const data = payload.data ?? {}

    return {
      eventId: `${event}:${String(data.id ?? data.transfer_code ?? 'unknown')}`,
      type: event,
      transferId: data.transfer_code,
      reference: data.reference,
      status:
        event === 'transfer.success'
          ? 'paid'
          : event === 'transfer.failed' || event === 'transfer.reversed'
            ? 'failed'
            : undefined,
      failureReason: event === 'transfer.success' ? null : (data.reason ?? null),
    }
  }
}

/**
 * Paystack's transfer states, narrowed to the three that matter.
 *
 * `otp` means the transfer is waiting on a one-time code, which is still
 * pending rather than failed: someone with the code can finish it.
 */
function transferStatusFrom(status?: string): PayoutTransferResult['status'] {
  switch (status) {
    case 'success':
      return 'paid'
    case 'failed':
    case 'reversed':
      return 'failed'
    default:
      return 'pending'
  }
}
