# Direct Stripe.js checkout — 2026-10-23

Release: `2026.10.23-direct-stripe.1`. Server handlers, database migrations, merchant eligibility, accounting and live activation are unchanged.

## Problem and implementation

The deployed Readdy payment chunk `RidePaymentElements-VWx3Og6V.js` contained React Stripe.js 4.0.2 and the Stripe.js 7.8.0 loader targeting Basil, while GitHub pinned React Stripe.js 7.0.0 and Stripe.js 10.1.0. Its naming adapter still invoked the legacy asynchronous initCheckout API and used legacy option conversion. The published release marker therefore did not identify the SDK actually executed.

The client now uses Stripe's documented JavaScript Checkout Sessions + Payment Element integration directly. It loads `https://js.stripe.com/endive/stripe.js` from Stripe, validates the constructor version and modern API capability, calls initCheckoutElementsSdk / loadActions, subscribes to session changes and mounts the native payment, wallet and contact Elements. Card data remains entirely in Stripe iframes.

The two Stripe npm browser dependencies and the npm-export guard are removed because payment no longer imports either npm package. The loader and small React bindings are repository source. Readdy's stale npm dependency cache cannot select a different payment provider implementation.

## Recovery, performance and safeguards

- One shared official script download; merchant instances and Session secrets remain separate. Failed or stalled script downloads release the shared promise and may be retried. A legacy global Stripe constructor is never accepted as the modern runtime.
- Idle preloading occurs only during an authenticated ride for which the server reports eligible online payment and a configured publishable key. It downloads the SDK without creating a Session, initializing a merchant or confirming payment. Offline and data-saver clients skip this preload.
- The dialog still loads lazily after trip end. SDK/session loading is parallel if no earlier warm-up was possible. The payment JavaScript measured about 4.6 KB gzip before the preload split, compared with about 9 KB for the prior React SDK bundle; Stripe's external script is separate.
- The 12-second initialization recovery, stable Session retry, in-memory client secret, explicit Stripe saving consent, exact amount/mode/Session checks, single-flight confirmation and server-only paid state are retained.
- Elements are destroyed on unmount; callbacks ignore closed providers. Reactive session updates do not remount card fields. External bank authentication retains its accessible overlay and focus behavior.
- No automatic client start confirmation, new Realtime channel, local paid write or live activation is introduced.

## Validation

- Full npm check: build configuration, lint, 784 unit tests, TypeScript and production build passed. New loader tests exercise old globals, concurrent download sharing, separate merchant initialization, failed/stalled download recovery and rejected incompatible runtimes.
- 18 focused scenarios passed: nine Chromium and nine WebKit scenarios cover payment recovery, one Session across retries, parallel loading, wallet/card UI, viewport/keyboard/focus, external bank overlay, eligible ride preloading and absence of payment creation during preloading.
- A clean production npm ci succeeded without either Stripe browser npm package.
- A separate native browser check loaded the real Endive SDK and real card iframe, filled the Stripe test card, observed canConfirm become true, confirmed once and left application fulfillment waiting for the authoritative server.
- Stripe Session `cs_test_a1vb50vbmWEjUj6NjOmUHC2qBM5STh1Z2pT19WG33m9NRAJ3KHwW5tgz4v` reported complete/paid. PaymentIntent `pi_3UTUN1PYGWX41ye80aLu895n` reported succeeded with 123 EUR minor units received. Refund `re_3UTUN1PYGWX41ye80t9YyFHU` succeeded for the full 123 units.
- That payment used a synthetic Test customer and an unregistered synthetic order, not an actual app ride. No real funds or real accounting changed. The isolated Playwright runner initially assumed an already-open card accordion; the successful independent native check explicitly selected the card method. SDK/API success was independently verified.
- Actual device Apple Pay/Google Pay and issuer 3DS approval still require the phone check after publication. The automated wallet/bank-overlay scenarios are UI simulations, not evidence of hardware wallet approval.

## Publication

Pull main into Readdy and publish the updated source or prepared out package. The old naming adapter must not replace the local Stripe bindings. The generic project build can use npm ci from the committed lockfile; it no longer needs a particular installed Stripe browser npm package.

Verify /release.json reports 2026.10.23-direct-stripe.1 and reopen the PWA. Test an ended eligible ride with the authorized Test profile. Live payments remain disabled and other companies remain ineligible until their separate merchant integration is configured.
