# Next.js App Router example

A minimal end-to-end HBL hosted checkout: start a payment, redirect to HBL,
verify the customer's return.

## Running it

```bash
npm install next react react-dom hbl-payment-gateway
cp .env.example .env.local   # fill in your HBL test credentials
npm run dev
```

Then open <http://localhost:3000>.

## What to look at

| File | Why it matters |
|---|---|
| `app/api/checkout/route.ts` | Creates the session and **persists `successIndicator` before redirecting**. |
| `app/api/checkout/verify/route.ts` | Verifies the return. Never trusts the query string alone. |
| `app/checkout/result/page.tsx` | Result page that calls the verify endpoint. |
| `app/page.tsx` | The pay button. |
| `lib/orders.ts` | A stand-in for your database. Replace it. |

## Note on the in-memory store

`lib/orders.ts` keeps orders in a `Map` so the example runs with no database.
That is fine for a demo and wrong for production: it is lost on restart and not
shared between instances. `successIndicator` must be stored somewhere durable,
because without it you cannot verify a payment.
