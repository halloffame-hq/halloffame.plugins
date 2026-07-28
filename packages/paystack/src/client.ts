import type {
  PaystackInlineError,
  PaystackInlineSuccess,
  PaystackPopupConstructor,
  ResumePaystackPaymentOptions,
} from "./client-types";

export * from "./callback";
export * from "./client-types";

export async function resumePaystackPayment(
  options: ResumePaystackPaymentOptions,
): Promise<unknown> {
  const { default: PaystackPop } = (await import("@paystack/inline-js")) as {
    default: PaystackPopupConstructor;
  };
  const popup = new PaystackPop();

  return popup.resumeTransaction(options.accessCode, {
    onSuccess: (transaction: PaystackInlineSuccess) => {
      void options
        .verify(transaction.reference)
        .then((verification) =>
          options.onVerified?.(verification, transaction.reference),
        )
        .catch((error) => options.onError?.(error as Error));
    },
    onCancel: () => options.onCancel?.(),
    onError: (error: PaystackInlineError) =>
      options.onError?.(new Error(error.message)),
  });
}
