/**
 * The payout half of the host's provider contract.
 *
 * Mirrored here rather than imported, exactly as the payment types are: the
 * plugin must build without depending on the application it plugs into.
 */

export type PayoutRecipientStatus = 'pending' | 'verified' | 'rejected'

export interface PayoutFieldOption {
  value: string
  label: string
}

export interface PayoutRecipientField {
  key: string
  label: string
  help?: string
  required: boolean
  /** That the provider supplies this field's values, such as its banks. */
  optionsFromProvider?: boolean
  options?: PayoutFieldOption[]
}

export interface PayoutRecipientInput {
  ownerType: string
  ownerId: string
  name: string
  email: string
  currency: string
  countryCode?: string | null
  details: Record<string, string>
  returnUrl?: string
}

export interface PayoutRecipientResult {
  recipientId: string
  status: PayoutRecipientStatus
  onboardingUrl?: string | null
  bankName?: string | null
  last4?: string | null
}

export interface PayoutTransferInput {
  payoutId: string
  recipientId: string
  amountMinor: number
  currency: string
  reference: string
  idempotencyKey: string
  reason?: string
}

export interface PayoutTransferResult {
  transferId: string
  status: 'pending' | 'paid' | 'failed'
  failureReason?: string | null
}

export interface PayoutWebhookResult {
  eventId: string
  type: string
  transferId?: string
  reference?: string
  status?: 'paid' | 'failed'
  failureReason?: string | null
}

export interface PayoutProvider {
  readonly name: string
  readonly label: string
  readonly onboarding: 'fields' | 'hosted'
  readonly recipientFields: PayoutRecipientField[]
  /** Whether a registered destination is required before sending. */
  readonly requiresRecipient: boolean
  createRecipient(input: PayoutRecipientInput): Promise<PayoutRecipientResult>
  recipientStatus(recipientId: string): Promise<PayoutRecipientStatus>
  transfer(input: PayoutTransferInput): Promise<PayoutTransferResult>
  transferStatus?(transferId: string): Promise<PayoutTransferResult>
  fieldOptions?(key: string, currency?: string): Promise<PayoutFieldOption[]>
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<PayoutWebhookResult | null>
}

/* The slice of the Paystack SDK the payout provider uses. */

export interface PaystackRecipientData {
  recipient_code: string
  details?: {
    account_number?: string
    bank_name?: string | null
  }
}

export interface PaystackTransferData {
  id?: number | string
  transfer_code: string
  reference?: string
  status?: string
  failures?: unknown
}

export interface PaystackBank {
  name: string
  code: string
  currency?: string
  active?: boolean
}

export interface PaystackPayoutClient {
  misc?: {
    banks(query?: Record<string, unknown>): Promise<{
      status: boolean
      message: string
      data?: PaystackBank[] | null
    }>
  }
  recipient: {
    create(data: Record<string, unknown>): Promise<{
      status: boolean
      message: string
      data?: PaystackRecipientData | null
    }>
    fetch(id: string): Promise<{
      status: boolean
      message: string
      data?: PaystackRecipientData | null
    }>
  }
  transfer: {
    initiate(data: Record<string, unknown>): Promise<{
      status: boolean
      message: string
      data?: PaystackTransferData | null
    }>
    fetch(idOrCode: string): Promise<{
      status: boolean
      message: string
      data?: PaystackTransferData | null
    }>
  }
}

export interface PaystackPayoutOptions {
  secretKey?: string
  client?: PaystackPayoutClient
  /** `nuban` for Nigerian bank accounts; `mobile_money` and `basa` also exist. */
  recipientType?: string
}
