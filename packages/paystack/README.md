# Paystack payment provider

Paystack checkout, verification, authenticated webhooks, reusable payment
authorizations, and refunds for Hall Of Fame.

## Installation

Run the installation from the `halloffame.ng.api` directory so the provider is
recorded as a production dependency:

```sh
pnpm add @hallofame/payment-provider-paystack
```

Add the package to the API's explicit provider manifest in `package.json`.
Preserve any providers already listed:

```json
{
  "halloffame": {
    "paymentProviders": ["@hallofame/payment-provider-paystack"]
  }
}
```

Set the provider credentials in the API environment:

```env
PAYSTACK_SECRET_KEY=sk_live_...
PAYSTACK_CALLBACK_URL=https://app.example.com/settings/subscription
```

In the Paystack dashboard, configure the webhook URL using the public API
origin:

```text
https://api.example.com/api/billing/webhook/paystack
```

Restart the API after installing or changing the manifest. Confirm that
Paystack appears in the registered provider catalogue, then select `paystack`
as the active provider through the platform billing settings.

Do not place the Paystack secret key in `package.json` or commit it to source
control.
