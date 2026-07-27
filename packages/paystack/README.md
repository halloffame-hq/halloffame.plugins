# Paystack payment provider

Paystack checkout, verification, authenticated webhooks, reusable payment
authorizations, and refunds for Hall Of Fame.

```sh
pnpm add @hallofame/payment-provider-paystack
```

Configure the API with:

```env
PAYMENT_PROVIDER_PACKAGES=@hallofame/payment-provider-paystack
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_CALLBACK_URL=https://example.com/settings/subscription
```
