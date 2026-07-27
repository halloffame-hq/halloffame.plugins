import type {
  PaymentProvider,
  PaystackClient,
  PaystackProviderOptions,
} from "./types";

import { Paystack } from "paystack-sdk";
import { PaystackProvider } from "./PaystackProvider";

const required = (value: string | undefined, name: string): string => {
  if (!value?.trim())
    throw new Error(
      `${name} is required to use the Paystack payment provider.`,
    );

  return value.trim();
};

export function createPaymentProvider(
  options: PaystackProviderOptions = {},
): PaymentProvider {
  const secretKey = required(
    options.secretKey ?? process.env.PAYSTACK_SECRET_KEY,
    "PAYSTACK_SECRET_KEY",
  );
  const client =
    options.client ?? (new Paystack(secretKey) as unknown as PaystackClient);

  return new PaystackProvider(
    client,
    secretKey,
    options.callbackUrl ?? process.env.PAYSTACK_CALLBACK_URL,
  );
}

export { PaystackProvider } from "./PaystackProvider.js";
export * from "./types.js";
export default createPaymentProvider;
