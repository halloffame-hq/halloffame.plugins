import { createHmac, timingSafeEqual } from "node:crypto";

import type { WebhookResult } from "./types";

const header = (
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined => {
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );

  return match?.[1];
};

const sameSignature = (expected: string, received: string): boolean => {
  if (expected.length !== received.length) return false;

  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(received, "hex"),
  );
};

export function parsePaystackWebhook(
  secretKey: string,
  rawBody: string,
  headers: Record<string, string | undefined>,
): WebhookResult | null {
  const received = header(headers, "x-paystack-signature");
  if (!received) return null;
  const expected = createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");
  if (!sameSignature(expected, received)) return null;

  const payload = JSON.parse(rawBody) as {
    event?: string;
    data?: {
      id?: number | string;
      amount?: number;
      currency?: string;
      reference?: string;
      authorization?: {
        authorization_code?: string;
        signature?: string;
        channel?: string;
        brand?: string;
        card_type?: string;
        last4?: string;
        exp_month?: string;
        exp_year?: string;
        bank?: string;
        country_code?: string;
        reusable?: boolean;
      };
      customer?: { email?: string };
    };
  };
  const event = payload.event ?? "unknown";
  const data = payload.data ?? {};
  const authorization = data.authorization;
  const providerMethodId = authorization?.authorization_code;
  const signature = authorization?.signature;
  const email = data.customer?.email;

  return {
    eventId: `${event}:${String(data.id ?? data.reference ?? "unknown")}`,
    type: event,
    reference: data.reference,
    status:
      event === "charge.success"
        ? "paid"
        : event === "charge.failed"
          ? "failed"
          : undefined,
    amountMinor: data.amount,
    currency: data.currency,
    paymentMethod:
      providerMethodId && signature && email
        ? {
            providerMethodId,
            signature,
            email,
            type: authorization.channel ?? "card",
            brand: authorization.brand ?? authorization.card_type ?? null,
            last4: authorization.last4 ?? null,
            expMonth: authorization.exp_month ?? null,
            expYear: authorization.exp_year ?? null,
            bank: authorization.bank ?? null,
            countryCode: authorization.country_code ?? null,
            reusable: Boolean(authorization.reusable),
          }
        : undefined,
  };
}
