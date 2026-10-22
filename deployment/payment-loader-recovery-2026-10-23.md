# Payment loader recovery — 2026-10-23

Release: `2026.10.23-payment-loader.1`. Existing Test-mode restrictions remain; no backend, merchant eligibility, live activation or accounting changes.

## Observed failure

The published website reported `2026.10.22-inline-payments.1`, but its Readdy-built customer payment chunk `RidePaymentElements-CsRcW7D6.js` contained the legacy CheckoutProvider and useCheckout implementation. The adapter aliased CheckoutElementsProvider to that provider, omitted ContactDetailsElement when unavailable, and still passed the modern clientSecret options. The legacy provider expects fetchClientSecret and invokes stripe.initCheckout. This is not the supported contract of the pinned React Stripe.js 7.0.0 / Stripe.js 10.1.0 Elements integration. The supplied Safari screenshot remained at “Подготвяме начините за плащане…”.

The GitHub source and a clean production npm ci both export the five required modern React APIs. A successful bundle using legacy aliases therefore does not validate the payment screen.

## Changes

- Keep direct, typed imports of the supported CheckoutElementsProvider / useCheckoutElements API. No legacy alias adapter or empty replacement for a payment element.
- Run check:stripe-runtime as npm prebuild. It verifies exact runtime dependencies against the root manifest and lockfile, the actually resolved installed versions, executable checkout exports and the official loader. An incompatible installation fails clearly with npm ci recovery instructions.
- Keep Stripe code lazy-loaded only after an eligible ride ends. Within that payment chunk, the official loader starts its script download alongside the authenticated Session request, rather than after the request completes.
- After 12 seconds of stalled SDK initialization, show a usable retry instead of an indefinite loading message. SDK initialization failures and render errors also offer recovery.
- Retry remounts only the Stripe provider against the same in-memory Session. It does not create another order, expire a Session, submit a payment or locally mark a ride paid. The 12-second limit applies to initialization only; bank authentication and an uncertain payment keep their existing authoritative reconciliation rules.

## Validation

- npm run check passed: plugin-free build configuration, lint, 779 unit tests, runtime integrity prebuild, TypeScript and production build.
- 14 focused browser scenarios passed: seven in Chromium and seven in WebKit. Coverage includes stalled and rejected first initialization, retry of the same Session with one backend initialization request and zero confirmations, actual script download before the Session response, wallet/card selection, 320 px and keyboard viewports, focus restoration and external bank overlay interaction.
- A separate clean npm ci --omit=dev --ignore-scripts passed the runtime check. Controlled stale-version and missing-export fixtures each failed as intended; restoring the exact packages passed.
- These browser scenarios use a Stripe UI double. Device Apple Pay/Google Pay and real issuer approval still require a phone check after publication. No new Stripe charge was made for this fix.

## Publish through Readdy

Pull the latest main. Install dependencies with npm ci from the committed lockfile, then run npm run build and Publish. Clear the dependency/build cache if Readdy continues to resolve a legacy package. Do not restore the legacy alias adapter or remove the runtime check to obtain a green build.

Verify /release.json reports 2026.10.23-payment-loader.1 and reopen the PWA. Test an ended, eligible ride with the authorized Test-mode customer. Test mode remains restricted and does not write real revenue. Keep existing pending Sessions and webhook reconciliation intact.
