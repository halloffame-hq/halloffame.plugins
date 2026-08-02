declare module '@paystack/inline-js' {
  export default class PaystackPop {
    resumeTransaction(
      accessCode: string,
      callbacks: {
        onSuccess: (transaction: { id: number; reference: string; message: string }) => void
        onCancel: () => void
        onError: (error: { message: string }) => void
      },
    ): unknown
  }
}
