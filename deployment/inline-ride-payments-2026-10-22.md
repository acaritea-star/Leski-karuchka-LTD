# In-app ride payments

After the assigned driver ends the trip, the customer can pay directly on the ride screen. Express Checkout offers supported Apple Pay / Google Pay wallets; Payment Element supplies the card fallback. The fare remains server-controlled and the customer does not confirm the start of the trip.

## Release and scope

- Product source: `a50ffab1ac0d6cc850f7e6cf76c12ba0039108c7`.
- Applied migration: `20261022062508_inline_ride_checkout.sql`.
- Deployed `ride-checkout` v6 and `stripe-webhook` v11. Existing bearer/profile/MFA/budget checks and verified raw-body Stripe signatures remain in place.
- Test mode only, with the existing explicit customer allowlist. Zero live merchants are enabled. Root company and direct city branches share one legal merchant; other firms remain ineligible. Stripe Connect is not activated.
- Payment domain `leskikaruchka.com` is registered for primary-account Test mode; wallet visibility is determined by Stripe and the customer's device/browser/wallet.

## Payment boundaries

- Price, currency, customer, company and Stripe account come from a locked order. One active order per ride and deterministic Stripe idempotency keys protect refreshes and retries.
- Private Stripe Customer mappings are scoped by application user, Stripe account and test/live mode. They are never matched by email or exposed to drivers. Customer creation also uses a stable idempotency key.
- The owning customer alone receives a no-store Session client secret. Secrets stay in component memory, not local storage, database rows, source or logs. Only the non-sensitive wallet/card preference is remembered, with user/account/environment scope.
- Card saving uses Stripe's explicit consent control. No automatic off-session setup is requested; redisplay uses consented methods. Hosted Sessions already in progress remain resumable rather than being replaced by another payment.
- Session and PaymentIntent customer identity, exact amount, currency, metadata and mode are verified before settlement. SDK success triggers server reconciliation and never directly marks a ride paid.
- Cash can unlock only after expiration and verified reconciliation. Uncertain or concurrent online payment remains locked. Test settlement never posts to real transactions, driver money, trips or accounting totals.

## UX and performance

- The payment dialog opens once after trip end and can be reopened. Wallet/card code and the official Stripe.js loader are deferred until payment is needed; the app payment chunk is about 9 KB gzip, excluding Stripe's separately loaded SDK.
- Newly created unpaid Sessions render without a redundant Stripe GET. Reopening uses the same Session. Reconnection/visibility recovery and existing bounded payment-state polling reuse the authoritative order without an additional Realtime channel.
- The dialog is bounded by the visual viewport, scrolls with the keyboard, restores focus and keeps the close control accessible. Its colours are defined at the portal rather than inherited from the customer panel.
- Payment uses an accessible overlay that allows Stripe's bank authentication iframe above it; focus trapping pauses during SDK confirmation. Other app modals retain the native dialog implementation.
- The canonical return URL is set only when the server creates the Session. Passing `returnUrl` again to `checkout.confirm()` caused a real Stripe IntegrationError and has been removed, with contract regression coverage.

## Validation

- Check run `39853801976`: 777 unit tests, lint, type checking, production build, dependency audit, Deno checks and 215 Chromium/WebKit browser scenarios passed; one pre-existing browser skip.
- Database run `39855069461`: schema, migrations, rollback, isolation, money concurrency and MFA suites passed. Fixture commit `d9ae212c065f28059284145666f0b34e9bb71654` sets the payment report test to Sofia business dates so it also works after UTC 21:00.
- Browser coverage includes wallet/card switching, real 320 px width, keyboard viewport, focus restoration, repeated clicks, delayed authoritative confirmation and an interactive bank overlay.
- A separate synthetic Test-mode Stripe Customer and real embedded card form completed a 1.23 EUR payment. Session `cs_test_a1LToMkKSIAJg0YaP1sgb1iGsISAMkPU5A7pYNgZlQ6CWzV9b9j4SRgqZa` reported `complete/paid`; PaymentIntent `pi_3UTTM5PYGWX41ye83MSujoJg` reported `succeeded`, 123 minor units received. The test amount was fully refunded. This SDK/API smoke used an unregistered synthetic order and did not alter a customer's real ride or accounting.
- The isolated browser smoke reached its payment assertions; its first teardown reported an in-flight Stripe telemetry request after the proxy context was disposed. The local-only harness cleanup was corrected. The committed browser suite above is green.
- A real 3DS test triggered `requires_action` and displayed an interactive Stripe bank prompt; bank authentication completion on that isolated proxy run was not established. The committed overlay test covers focus/click access; device-specific Apple Pay/Google Pay and bank approval still require a phone check on the published frontend.
- Anonymous checkout and invalid webhook signatures were rejected. Production checks found zero enabled live merchants and zero test rows in the real transaction ledger. No live charge was made.

## Publication

Publish the GitHub source/built package through the current hosting workflow. Check `/release.json` for `2026.10.22-inline-payments.1`, then reopen the PWA before testing. Historical hashed assets are retained for existing tabs.

Keep the database, pending orders and reconciliation/webhook handlers during a frontend rollback. Reconcile pending Sessions before disabling new merchant payments; do not delete orders or mark them unpaid locally. Live activation remains a separate release.
