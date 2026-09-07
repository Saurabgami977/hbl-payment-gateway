# hbl-payment-gateway

[![npm version](https://img.shields.io/npm/v/hbl-payment-gateway.svg)](https://www.npmjs.com/package/hbl-payment-gateway)
[![CI](https://github.com/Saurabgami977/hbl-payment-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Saurabgami977/hbl-payment-gateway/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/hbl-payment-gateway.svg)](./LICENSE)
[![types](https://img.shields.io/npm/types/hbl-payment-gateway.svg)](https://www.npmjs.com/package/hbl-payment-gateway)

TypeScript client for the **HBL Internet Payment Gateway** — Habib Bank Limited's online card processing, which runs on Mastercard Payment Gateway Services (MPGS) v100.

Accept card payments in Pakistan without hand-rolling the REST calls, and without the two mistakes that cost merchants real money: trusting the redirect URL, and mis-reading a declined payment as a successful one.

```bash
npm install hbl-payment-gateway
```

- **Zero runtime dependencies.** Nothing but `fetch`.
- **Runs anywhere.** Node 18+, Next.js (App and Pages Router), Express, Cloudflare Workers, Deno, Bun.
- **Fully typed**, with JSDoc on every public method.
- **Safe by construction.** Verification cannot be short-circuited, credentials cannot reach the browser, and money-moving calls are never silently retried.
- **Optional React component** for the hosted checkout redirect.

---

## Contents

- [Why this package](#why-this-package)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [The payment flow](#the-payment-flow)
- [Full example: Next.js App Router](#full-example-nextjs-app-router)
- [React component](#react-component)
- [Capture, refund and void](#capture-refund-and-void)
- [Error handling](#error-handling)
- [Amounts](#amounts)
- [Idempotency](#idempotency)
- [Security notes](#security-notes)
- [API reference](#api-reference)
- [Testing your integration](#testing-your-integration)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Disclaimer](#disclaimer)

---

## Why this package

HBL gives you a merchant ID, an API password, and a link to Mastercard's generic gateway documentation. What it does not give you is a client library, so every merchant writes the same integration from scratch — and tends to get the same three things wrong.

**The gateway returns HTTP 200 for failures.** A declined card comes back as `200 OK` with `{"result": "FAILURE"}` in the body. Code that checks `if (response.ok)` treats that as a paid order. This package checks the payload, not the status line, on every operation that moves money.

**The redirect can be forged.** After payment, HBL sends the customer back to `yourReturnUrl?resultIndicator=abc123`. That URL is in the customer's address bar, so anyone can type it. The only safe check compares the indicator against a value you stored server-side *and* re-reads the order from the gateway over an authenticated channel. `checkout.verify()` does both, throws on any mismatch, and offers no flag to skip the server-side half.

**Amounts get mangled.** MPGS wants a decimal string, so integrations do `(price * quantity).toFixed(2)` and eventually ship `59.97000000000001` or a rounding error. This package validates every amount against the currency's minor unit and refuses anything ambiguous before a request is sent.

---

## Quick start

```ts
import { HblGateway } from 'hbl-payment-gateway';

const hbl = new HblGateway({
  merchantId: process.env.HBL_MERCHANT_ID!,
  apiPassword: process.env.HBL_API_PASSWORD!,
  merchantName: 'Acme Store',        // shown on the hosted payment page
});

// 1. Start the payment on your server.
const session = await hbl.checkout.initiate({
  orderId: 'ord_1024',
  amount: 1500,
  currency: 'PKR',
  description: 'Starter plan — 1 month',
  returnUrl: 'https://acme.example/checkout/result',
});

// Store session.successIndicator against your order. You cannot verify without it.
await db.orders.update('ord_1024', {
  gatewaySuccessIndicator: session.successIndicator,
});

// 2. Send sessionId to the browser and redirect the customer (see below).

// 3. When they come back, verify before marking the order paid.
const result = await hbl.checkout.verify({
  orderId: 'ord_1024',
  resultIndicator: url.searchParams.get('resultIndicator'),
  successIndicator: order.gatewaySuccessIndicator,
  expectedAmount: 1500,
  expectedCurrency: 'PKR',
});

console.log(result.status); // 'CAPTURED'
```

Or read credentials straight from the environment:

```ts
const hbl = HblGateway.fromEnv();
// HBL_MERCHANT_ID, HBL_API_PASSWORD, HBL_GATEWAY_HOST, HBL_MERCHANT_NAME
```

---

## Configuration

```ts
new HblGateway({
  merchantId: 'YOUR_MERCHANT_ID',   // required
  apiPassword: 'YOUR_API_PASSWORD', // required
  host: 'hbl.gateway.mastercard.com',
  apiVersion: 100,
  merchantName: 'Acme Store',
  timeoutMs: 30_000,
  maxRetries: 2,
  fetch: customFetch,
  onRequest: (info) => logger.debug(info),
  onResponse: (info) => logger.debug(info),
});
```

| Option | Default | Notes |
|---|---|---|
| `merchantId` | — | Sent as the Basic auth username `merchant.<merchantId>`. |
| `apiPassword` | — | Never logged, never serialised, never sent to the browser. |
| `host` | `hbl.gateway.mastercard.com` | Use the test host HBL gives you during integration. A pasted `https://` prefix or trailing slash is stripped for you. |
| `apiVersion` | `100` | MPGS REST version. |
| `merchantName` | — | Business name shown to the customer on the hosted page. |
| `timeoutMs` | `30000` | Per attempt, enforced with `AbortSignal`. |
| `maxRetries` | `2` | Applies to `GET` only. See [Idempotency](#idempotency). |
| `fetch` | global `fetch` | Inject your own for tests, proxies or instrumentation. |
| `onRequest` / `onResponse` | — | Observability hooks. `Authorization` is already redacted. |

### Environment variables

```bash
HBL_MERCHANT_ID=your_merchant_id
HBL_API_PASSWORD=your_api_password
HBL_GATEWAY_HOST=hbl.gateway.mastercard.com   # optional
HBL_MERCHANT_NAME=Your Business Name          # optional
```

`HblGateway.fromEnv()` throws an `HblConfigError` naming every missing variable at once, rather than failing later with an opaque 401.

---

## The payment flow

```
  Your server                    Customer's browser                HBL gateway
       │                                 │                              │
       │  1. checkout.initiate()         │                              │
       ├─────────────────────────────────┼─────────────────────────────►│
       │◄────────────────────────────────┼──────────────────────────────┤
       │     sessionId + successIndicator│                              │
       │                                 │                              │
   store successIndicator                │                              │
       │                                 │                              │
       │  2. send sessionId ────────────►│                              │
       │                                 │  3. Checkout.showPaymentPage()
       │                                 ├─────────────────────────────►│
       │                                 │                              │
       │                                 │     customer enters card     │
       │                                 │◄─────────────────────────────┤
       │                                 │  4. redirect to returnUrl    │
       │                                 │     ?resultIndicator=…       │
       │                                 │                              │
       │  5. checkout.verify()  ◄────────┤                              │
       ├─────────────────────────────────┼─────────────────────────────►│
       │                                 │      GET /order/{orderId}    │
       │◄────────────────────────────────┼──────────────────────────────┤
       │     { paid: true, status }      │                              │
  mark order paid                        │                              │
```

Step 5 is the one that matters. The `resultIndicator` arriving in step 4 travelled through the customer's browser, so it proves nothing on its own — `verify()` re-reads the order directly from HBL before it will tell you the order is paid.

---

## Full example: Next.js App Router

**Start the payment** — `app/api/checkout/route.ts`

```ts
import { HblGateway, HblError } from 'hbl-payment-gateway';
import { NextResponse } from 'next/server';

const hbl = HblGateway.fromEnv();

export async function POST(request: Request) {
  const { orderId } = await request.json();
  const order = await db.orders.findById(orderId);

  if (order.status !== 'PENDING') {
    return NextResponse.json({ error: 'Order is not payable' }, { status: 409 });
  }

  try {
    const session = await hbl.checkout.initiate({
      orderId: order.gatewayOrderId,
      amount: order.total,
      currency: order.currency,
      description: order.description,
      returnUrl: `${process.env.NEXT_PUBLIC_BASE_URL}/checkout/${orderId}/result`,
    });

    // Must happen before the customer is redirected.
    await db.orders.update(orderId, {
      gatewaySuccessIndicator: session.successIndicator,
    });

    // sessionId, host and the script URL are safe to expose. The API password is not.
    return NextResponse.json({
      sessionId: session.sessionId,
      host: session.host,
      checkoutJsUrl: session.checkoutJsUrl,
    });
  } catch (error) {
    if (error instanceof HblError) {
      console.error('[hbl] initiate failed', error.message);
      return NextResponse.json({ error: 'Could not start payment' }, { status: 502 });
    }
    throw error;
  }
}
```

**Verify the return** — `app/api/checkout/verify/route.ts`

```ts
import { HblGateway, HblVerificationError } from 'hbl-payment-gateway';
import { NextResponse } from 'next/server';

const hbl = HblGateway.fromEnv();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get('orderId')!;
  const order = await db.orders.findById(orderId);

  // Returning early keeps a refreshed result page from charging twice.
  if (order.status === 'PAID') {
    return NextResponse.json({ status: 'PAID', alreadyPaid: true });
  }

  try {
    const result = await hbl.checkout.verify({
      orderId: order.gatewayOrderId,
      resultIndicator: url.searchParams.get('resultIndicator'),
      successIndicator: order.gatewaySuccessIndicator,
      expectedAmount: order.total,
      expectedCurrency: order.currency,
    });

    await db.orders.markPaid(orderId, { status: result.status });
    return NextResponse.json({ status: 'PAID' });
  } catch (error) {
    if (error instanceof HblVerificationError) {
      // reason: 'indicator_mismatch' | 'gateway_not_paid' | 'amount_mismatch' | …
      await db.orders.markFailed(orderId, error.reason);
      return NextResponse.json({ status: 'FAILED', reason: error.reason });
    }
    throw error;
  }
}
```

A complete runnable version lives in [`examples/nextjs-app-router`](./examples/nextjs-app-router).

---

## React component

The `/react` subpath handles loading HBL's `checkout.min.js`, wiring its `data-error` and `data-cancel` attributes, and opening the payment page. It is a client component, and it accepts only browser-safe values — there is no way to pass credentials through it.

```tsx
'use client';
import { HblCheckout } from 'hbl-payment-gateway/react';

export function PayButton({ session }) {
  return (
    <HblCheckout
      sessionId={session.sessionId}
      host={session.host}
      errorUrl="https://acme.example/checkout/result?error=true"
      cancelUrl="https://acme.example/cart"
      className="btn btn-primary"
    >
      Pay now
    </HblCheckout>
  );
}
```

Nothing is styled for you — pass a `className` and it inherits your design system. Any prop a `<button>` accepts is forwarded.

For full control, use the hook:

```tsx
'use client';
import { useHblCheckout } from 'hbl-payment-gateway/react';

export function PayButton({ session }) {
  const { showPaymentPage, loading, error } = useHblCheckout({
    sessionId: session.sessionId,
    host: session.host,
    onError: (e) => toast.error('Payment failed'),
    onCancel: () => toast('Payment cancelled'),
    preload: true,   // fetch the script on mount instead of on click
  });

  return (
    <>
      <button onClick={showPaymentPage} disabled={loading}>
        {loading ? 'Loading…' : 'Pay now'}
      </button>
      {error && <p role="alert">{error.message}</p>}
    </>
  );
}
```

`react` is an **optional peer dependency**. Importing the main entry point never pulls React into your bundle.

---

## Capture, refund and void

Use `operation: 'AUTHORIZE'` when you want to place a hold and take the money later — shipping physical goods, for instance.

```ts
// 1. Authorize at checkout instead of purchasing outright.
await hbl.checkout.initiate({
  orderId: 'ord_1024',
  amount: 1500,
  currency: 'PKR',
  returnUrl: 'https://acme.example/checkout/result',
  operation: 'AUTHORIZE',
});

// 2. Capture when the goods ship.
await hbl.transactions.capture('ord_1024', {
  amount: 1500,
  currency: 'PKR',
  transactionId: 'capture-ord_1024-1',
});

// 3. Or release the hold if the order is cancelled before capture.
await hbl.transactions.void('ord_1024', { targetTransactionId: 'auth-1' });

// 4. Refund a captured payment, in full or in part.
await hbl.transactions.refund('ord_1024', {
  amount: 500,
  currency: 'PKR',
  transactionId: 'refund-ord_1024-1',
});
```

Void works only before settlement; afterwards the gateway rejects it and a refund is the only route.

Reading back what happened:

```ts
const order = await hbl.orders.retrieve('ord_1024');
console.log(order.status, order.totalCapturedAmount, order.totalRefundedAmount);

const txn = await hbl.transactions.retrieve('ord_1024', 'capture-ord_1024-1');
console.log(txn.response?.gatewayCode);
```

Retrieval never throws because of a failed payment — a declined transaction is still a successful read, and inspecting it is the point.

---

## Error handling

Everything thrown extends `HblError`, so one `instanceof` separates gateway problems from bugs in your own code.

| Error | Meaning | What to do |
|---|---|---|
| `HblConfigError` | Missing credentials, bad amount, invalid currency | Fix the code. Thrown before any network call. |
| `HblApiError` | Gateway rejected the request | Log `supportCode` and investigate. |
| `HblDeclineError` | Card was declined (extends `HblApiError`) | Show the customer a message; check `isRetryable`. |
| `HblNetworkError` | DNS, TLS, socket or timeout | Retry, or surface a transient failure. |
| `HblVerificationError` | The return could not be trusted | Do **not** mark the order paid. |

```ts
import {
  HblDeclineError,
  HblNetworkError,
  HblVerificationError,
  describeGatewayCode,
} from 'hbl-payment-gateway';

try {
  await hbl.transactions.capture(orderId, { amount, currency: 'PKR' });
} catch (error) {
  if (error instanceof HblDeclineError) {
    // Customer-safe wording, deliberately vague about why.
    return { message: describeGatewayCode(error.gatewayCode), retryable: error.isRetryable };
  }
  if (error instanceof HblNetworkError) {
    return { message: 'The bank did not respond. Please try again.' };
  }
  if (error instanceof HblVerificationError) {
    console.error('verification failed:', error.reason);
    return { message: 'We could not confirm your payment.' };
  }
  throw error;
}
```

`HblApiError` carries `result`, `errorCause`, `explanation`, `field`, `supportCode`, `httpStatus` and `raw`. Quote `supportCode` when you raise a ticket with HBL.

`HblVerificationError.reason` is one of `indicator_mismatch`, `missing_indicator`, `gateway_not_paid`, `amount_mismatch` or `currency_mismatch`.

---

## Amounts

Pass a number or a string; both are validated against the currency's minor unit and converted to the decimal string MPGS expects.

```ts
normalizeAmount(1500, 'PKR')        // '1500.00'
normalizeAmount('1500.5', 'PKR')    // '1500.50'
normalizeAmount(19.99 * 3, 'PKR')   // '59.97'  — float drift absorbed
normalizeAmount(1500, 'JPY')        // '1500'   — zero-decimal currency
normalizeAmount(1.005, 'PKR')       // throws HblConfigError
```

That last line is deliberate. `1.005` cannot be represented exactly in PKR, and quietly rounding it to `1.00` or `1.01` is a decision about someone's money that a library should not make on your behalf. Round it yourself, explicitly, and the ambiguity becomes visible in your code.

---

## Idempotency

MPGS deduplicates on the pair `{orderId, transactionId}`:

- **Same transaction ID** → the retry is a no-op, and the original result is returned.
- **New transaction ID** → a second capture or refund is performed.

So if a capture times out and you want to retry safely, reuse the ID:

```ts
const transactionId = `capture-${orderId}-1`;   // derived from your data, stable across retries
await hbl.transactions.capture(orderId, { amount, currency: 'PKR', transactionId });
```

When you omit `transactionId`, the package generates a random one — correct for a first attempt, wrong for a retry.

For the same reason, automatic retries apply to `GET` only. A `capture` that fails at the socket level may or may not have reached the gateway, and this package will not gamble with a double charge on your behalf. Retry deliberately, with an ID you chose.

---

## Security notes

**Never verify a payment from the query string alone.** The `resultIndicator` reaches you through the customer's browser. `checkout.verify()` compares it in constant time against your stored `successIndicator` *and* re-reads the order from HBL. There is no option to skip the second check.

**Keep credentials on the server.** `apiPassword` is redacted in the `onRequest` hook and replaced with `[REDACTED]` by `toJSON()`, so an accidental `console.log(hbl)` cannot leak it. The `/react` entry point accepts only `sessionId`, `host` and `checkoutJsUrl`.

**Check the amount, not just the status.** Pass `expectedAmount` and `expectedCurrency` to `verify()`. Without them, an order paid for the wrong amount still verifies as paid.

**Guard against replay.** Return early when an order is already `PAID`, as in the example above, so a refreshed result page cannot re-run your fulfilment logic.

Found a vulnerability? See [SECURITY.md](./SECURITY.md).

---

## API reference

### `new HblGateway(config)` · `HblGateway.fromEnv(overrides?, env?)`

Properties: `checkout`, `orders`, `transactions`, `sessions`.
Getters: `host`, `merchantId`, `checkoutJsUrl` — all browser-safe.

### `hbl.checkout`

| Method | Description |
|---|---|
| `initiate(params)` | Creates a hosted checkout session. Returns `{ sessionId, successIndicator, checkoutVersion, checkoutJsUrl, merchantId, host, raw }`. |
| `verify(params)` | Verifies the customer's return. Returns `{ paid: true, status, amount, currency, order }` or throws. |

`initiate` accepts `orderId`, `amount`, `currency`, `returnUrl` (required), plus `description`, `operation` (`PURCHASE` \| `AUTHORIZE` \| `VERIFY`), `merchantName`, `merchantLogo`, `cancelUrl`, `timeoutUrl`, `timeoutSeconds`, `customer`, `billing` and `extra`.

`verify` accepts `orderId`, `resultIndicator`, `successIndicator`, plus `expectedAmount`, `expectedCurrency` and `acceptedStatuses`.

### `hbl.orders` · `hbl.sessions`

`retrieve(id)` on each. Neither throws for a failed payment.

### `hbl.transactions`

`retrieve(orderId, transactionId)`, `capture(orderId, params)`, `refund(orderId, params)`, `void(orderId, params)`.

### Helpers

`normalizeAmount`, `normalizeCurrency`, `minorUnits`, `amountsEqual`, `describeGatewayCode`, `isRetryableGatewayCode`, `GATEWAY_CODE_MESSAGES`, `configFromEnv`, `resolveConfig`.

### `hbl-payment-gateway/react`

`<HblCheckout>`, `useHblCheckout()`.

---

## Testing your integration

HBL issues separate test credentials and a test host. Point `host` at it and use Mastercard's standard test cards — the last digits of the amount can be used to trigger specific gateway responses, which your HBL integration contact will confirm for your account.

This package's own suite never touches a network. Inject a `fetch` to do the same in yours:

```ts
const hbl = new HblGateway({
  merchantId: 'TEST',
  apiPassword: 'test',
  fetch: async () =>
    new Response(JSON.stringify({
      result: 'SUCCESS',
      session: { id: 'SESSION123' },
      successIndicator: 'abc123',
    })),
});
```

---

## Troubleshooting

**`401 Unauthorized`** — the username must be `merchant.<merchantId>`, which this package builds for you. Check that `merchantId` and `apiPassword` are the pair for the host you are calling: test credentials do not work against the production host.

**`INVALID_REQUEST` on `order.amount`** — the amount does not match the currency's minor unit. `normalizeAmount` catches most of these before the request leaves.

**Payment succeeds but `verify()` says `gateway_not_paid`** — you are probably verifying a different order ID than the one you sent to `initiate()`. Store the gateway order ID alongside your own.

**`indicator_mismatch` on every payment** — the `successIndicator` was not persisted before the redirect, or is being read from a different record than the one it was saved against.

**The React component does nothing on click** — check the browser console for a Content Security Policy violation. HBL's script is loaded from your gateway host, which must be allowed in `script-src`.

**`window.Checkout is not defined`** — the script was blocked or the host is wrong. Confirm `checkoutJsUrl` resolves in a browser tab.

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
git clone https://github.com/Saurabgami977/hbl-payment-gateway.git
cd hbl-payment-gateway
npm install
npm test
```

---

## Disclaimer

This is an unofficial, community-maintained package. It is not affiliated with, endorsed by, or supported by Habib Bank Limited or Mastercard. "HBL" and "Mastercard" are trademarks of their respective owners, used here only to describe what the package integrates with.

Verify behaviour against your own HBL test account before going live.

## License

[MIT](./LICENSE) © Saurav Gami
