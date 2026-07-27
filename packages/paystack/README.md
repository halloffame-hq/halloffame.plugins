# Paystack payment provider

Paystack checkout, verification, authenticated webhooks, reusable payment
authorizations, and refunds for Hall Of Fame.

```sh
pnpm add @hallofame/payment-provider-paystack
```

Add the installed package to the API's explicit provider manifest:

```json
{
  "halloffame": {
    "paymentProviders": ["@hallofame/payment-provider-paystack"]
  }
}
```

Configure its credentials:

```env
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_CALLBACK_URL=https://example.com/settings/subscription
```
