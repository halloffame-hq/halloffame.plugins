export interface CheckoutInput {
  invoiceId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  subjectType: string;
  subjectId: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutResult {
  reference: string;
  redirectUrl: string | null;
  status: "pending" | "paid";
}

export interface VerifyResult {
  status: "paid" | "pending" | "failed";
  paidAt?: Date | null;
  amountMinor?: number;
  currency?: string;
}

export interface PaymentMethodResult {
  providerMethodId: string;
  signature: string;
  email: string;
  type: string;
  brand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
  bank: string | null;
  countryCode: string | null;
  reusable: boolean;
}

export interface WebhookResult {
  eventId: string;
  type: string;
  reference?: string;
  status?: "paid" | "failed";
  amountMinor?: number;
  currency?: string;
  paymentMethod?: PaymentMethodResult;
}

export interface PaymentProvider {
  readonly name: string;
  readonly label: string;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  chargePaymentMethod(
    input: CheckoutInput,
    providerMethodId: string,
  ): Promise<CheckoutResult>;
  verify(reference: string): Promise<VerifyResult>;
  parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookResult | null>;
  refund(reference: string, amountMinor?: number): Promise<{ status: string }>;
}

export interface PaystackResponse<T> {
  status: boolean;
  message: string;
  data: T | null;
}

export interface TransactionData {
  id: number;
  amount: number;
  currency: string;
  paid_at?: Date | string | null;
  status: string;
  reference: string;
}

export interface InitializedData {
  authorization_url: string;
  reference: string;
}

export interface PaystackClient {
  transaction: {
    initialize(
      input: Record<string, unknown>,
    ): Promise<PaystackResponse<InitializedData>>;
    verify(reference: string): Promise<PaystackResponse<TransactionData>>;
    chargeAuthorization(
      input: Record<string, unknown>,
    ): Promise<PaystackResponse<TransactionData>>;
  };
  refund: {
    create(
      input: Record<string, unknown>,
    ): Promise<PaystackResponse<{ status?: string }>>;
  };
}

export interface PaystackProviderOptions {
  secretKey?: string;
  callbackUrl?: string;
  client?: PaystackClient;
}
