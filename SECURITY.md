# Security Policy

## Supported versions

The latest minor release receives security fixes.

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Reporting a vulnerability

Please report security issues privately, **not** through a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/Saurabgami977/hbl-payment-gateway/security/advisories/new)
for this repository.

Include what you can: affected versions, a description of the problem, steps to
reproduce, and the impact you think it has. You can expect an initial response
within a week.

Please do not include real merchant credentials, live session IDs or
cardholder data in a report. A redacted reproduction is always enough.

## Scope

In scope:

- Bypassing `checkout.verify()`, or getting it to report an unpaid order as paid
- Leaking `apiPassword` through logs, serialisation or the browser entry point
- Injection through order IDs, transaction IDs or other path segments
- Any path by which a caller could be made to double-charge a customer

Out of scope:

- Vulnerabilities in HBL's or Mastercard's gateway itself — report those to HBL
- Misconfiguration in an integrator's own application
- Denial of service by supplying deliberately malformed input to your own server

## Guidance for integrators

- Keep `apiPassword` server-side. Never ship it to the browser.
- Always pass `expectedAmount` and `expectedCurrency` to `checkout.verify()`.
- Return early when an order is already paid, so a refreshed result page cannot
  re-run fulfilment.
- Persist `successIndicator` before redirecting the customer.
