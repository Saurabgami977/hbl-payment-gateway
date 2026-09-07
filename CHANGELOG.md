# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-07

Initial release.

### Added

- `HblGateway` client for HBL's Internet Payment Gateway (MPGS v100), with
  `checkout`, `orders`, `transactions` and `sessions` resources.
- `checkout.initiate()` for hosted checkout sessions, supporting `PURCHASE`,
  `AUTHORIZE` and `VERIFY` operations.
- `checkout.verify()`, which compares the returned indicator in constant time
  and independently re-reads the order from the gateway before reporting a
  payment as successful.
- `transactions.capture()`, `refund()` and `void()`.
- Amount validation against ISO 4217 minor units, absorbing floating-point
  drift while rejecting genuinely ambiguous precision.
- Error hierarchy separating configuration mistakes, gateway errors, card
  declines, transport failures and verification failures.
- `describeGatewayCode()` for customer-safe decline wording.
- Optional `hbl-payment-gateway/react` entry point with `<HblCheckout>` and
  `useHblCheckout()`.
- Automatic retries for `GET` requests only, so a capture is never repeated
  without an explicit transaction ID.

[Unreleased]: https://github.com/Saurabgami977/hbl-payment-gateway/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Saurabgami977/hbl-payment-gateway/releases/tag/v0.1.0
