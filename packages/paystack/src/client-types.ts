export interface PaystackInlineSuccess {
  id: number
  reference: string
  message: string
}

export interface PaystackInlineError {
  message: string
}

export interface PaymentVerification {
  status: 'paid' | 'pending' | 'failed'
}

export interface ResumePaystackPaymentOptions {
  accessCode: string
  verify: (reference: string) => Promise<PaymentVerification>
  onVerified?: (verification: PaymentVerification, reference: string) => void
  onCancel?: () => void
  onError?: (error: Error) => void
}

export interface PaymentCallback {
  token: string
  reference: string
  url: URL
}

export interface PaymentCallbackListenerOptions {
  verify: (reference: string) => Promise<PaymentVerification>
  onVerified?: (verification: PaymentVerification, callback: PaymentCallback) => void
  onError?: (error: Error) => void
  currentUrl?: () => string
  eventTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  history?: Pick<History, 'replaceState'>
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

export interface PaystackPopup {
  resumeTransaction(
    accessCode: string,
    callbacks: {
      onSuccess: (transaction: PaystackInlineSuccess) => void
      onCancel: () => void
      onError: (error: PaystackInlineError) => void
    },
  ): unknown
}

export interface PaystackPopupConstructor {
  new (): PaystackPopup
}
