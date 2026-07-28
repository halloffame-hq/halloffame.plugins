import type {
  CheckoutInput,
  CheckoutResult,
  PaymentProvider,
  PaystackClient,
  VerifyResult,
  WebhookResult,
} from "./types";

import { parsePaystackWebhook } from "./webhook";
import { transactionStatus } from "./status";

export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";
  readonly label = "Paystack";

  constructor(
    private readonly client: PaystackClient,
    private readonly secretKey: string,
    private readonly callbackUrl?: string,
  ) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const response = await this.client.transaction.initialize({
      amount: String(input.amountMinor),
      email: input.customerEmail,
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl ?? this.callbackUrl,
      metadata: this.metadata(input),
    });
    if (!response.status || !response.data) throw new Error(response.message);

    return {
      reference: response.data.reference,
      redirectUrl: response.data.authorization_url,
      status: "pending",
      client: {
        provider: "paystack",
        token: response.data.access_code,
      },
    };
  }

  async chargePaymentMethod(
    input: CheckoutInput,
    providerMethodId: string,
  ): Promise<CheckoutResult> {
    const response = await this.client.transaction.chargeAuthorization({
      authorization_code: providerMethodId,
      amount: String(input.amountMinor),
      email: input.customerEmail,
      currency: input.currency,
      reference: input.reference,
      metadata: this.metadata(input),
    });
    if (!response.status || !response.data) throw new Error(response.message);

    return {
      reference: response.data.reference,
      redirectUrl: null,
      status:
        transactionStatus(response.data.status) === "paid" ? "paid" : "pending",
    };
  }

  async verify(reference: string): Promise<VerifyResult> {
    const response = await this.client.transaction.verify(reference);
    if (!response.status || !response.data) return { status: "failed" };

    return {
      status: transactionStatus(response.data.status),
      paidAt: response.data.paid_at ? new Date(response.data.paid_at) : null,
      amountMinor: Number(response.data.amount),
      currency: response.data.currency,
    };
  }

  async parseWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<WebhookResult | null> {
    return parsePaystackWebhook(this.secretKey, rawBody, headers);
  }

  async refund(
    reference: string,
    amountMinor?: number,
  ): Promise<{ status: string }> {
    const response = await this.client.refund.create({
      transaction: reference,
      amount: amountMinor,
    });
    if (!response.status || !response.data) throw new Error(response.message);

    return { status: response.data.status ?? "pending" };
  }

  private metadata(input: CheckoutInput): Record<string, unknown> {
    return {
      invoice_id: input.invoiceId,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      description: input.description,
      ...input.metadata,
    };
  }
}
