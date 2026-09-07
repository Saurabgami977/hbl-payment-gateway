# Contributing

Thanks for helping improve this package.

## Getting started

```bash
git clone https://github.com/Saurabgami977/hbl-payment-gateway.git
cd hbl-payment-gateway
npm install
npm test
```

| Command | What it does |
|---|---|
| `npm test` | Runs the suite once |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run type-check` | `tsc --noEmit` |
| `npm run build` | Builds `dist/` with tsup |

## Ground rules

**Tests never touch the network.** Every test injects a `fetch` stub — see
`test/helpers.ts`. A test that would call HBL's gateway will not be merged, so
that the suite stays fast, deterministic and runnable without credentials.

**Never commit credentials.** Not in tests, not in fixtures, not in an example.
If you capture a real gateway response to use as a fixture, redact the merchant
ID, session ID and indicators first.

**Money-moving operations stay strict.** `capture`, `refund` and `void` assert
`result === "SUCCESS"` and are never retried automatically. If you are changing
that behaviour, explain in the pull request why a double charge is not possible.

**Verification stays unskippable.** `checkout.verify()` deliberately offers no
way to bypass the server-side order re-read. Please do not add one.

## Pull requests

1. Open an issue first for anything larger than a bug fix.
2. Add tests covering the change.
3. Make sure `npm run type-check`, `npm test` and `npm run build` all pass.
4. Add a line to `CHANGELOG.md` under `## [Unreleased]`.
5. Keep commits focused, and describe the behaviour change in the PR body.

## Adding MPGS operations

The package covers Hosted Checkout and the order lifecycle. Direct Payment
operations that accept raw card numbers are **out of scope**: they pull
integrators into PCI DSS scope, and the hosted flow exists precisely to avoid
that. Tokenization and Hosted Session are open questions — raise an issue if
you need them.

## Releasing

Maintainers only.

1. Update the version in `package.json` and move the `## [Unreleased]` entries
   in `CHANGELOG.md` under the new version heading.
2. Commit, then tag: `git tag v0.1.1 && git push origin v0.1.1`.
3. The release workflow runs the checks, verifies the tag matches
   `package.json`, and publishes with a provenance attestation.

This requires an npm **granular access token** with read/write on packages and
**bypass 2FA** enabled, stored as the `NPM_TOKEN` repository secret.

### Publishing by hand

Only if CI is unavailable. npm accounts with 2FA on writes reject a plain
`npm publish` with `403 Forbidden`:

```bash
npm publish --otp=123456                 # TOTP authenticator code
NPM_CONFIG_TOKEN=npm_xxxxx npm publish   # or a bypass-2FA granular token
```

A local publish cannot generate provenance — that needs a CI provider with
OIDC, which is why `--provenance` lives in the release workflow rather than in
`publishConfig`.

## Reporting security issues

Please do not open a public issue. See [SECURITY.md](./SECURITY.md).
