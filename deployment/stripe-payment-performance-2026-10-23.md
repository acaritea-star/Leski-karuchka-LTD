# Faster ride payment form — 2026-10-23

Release: `2026.10.23-payment-performance.1`. Test mode only. No database, webhook, accounting or merchant-eligibility changes.

## Diagnosis and implementation

The deployed direct-SDK release still rendered the card Element only after `loadActions()` resolved and Express Checkout reported wallet availability. Those sequential gates deferred iframe and field loading. The 12-second loading branch replaced the form, and switching between wallet/card removed the card iframe and its entered data.

The card and Express Elements now mount immediately after the synchronous SDK initialization, while actions and wallet detection run concurrently. An incomplete or mismatched Session cannot be confirmed: the exact Session, EUR fare and mode checks remain mandatory, and card confirmation additionally requires a ready Element and `canConfirm`.

- A slow-loading notice no longer replaces the Elements. The script has a separate 30-second hard deadline so a viable slow download is not discarded at 10 seconds. Recovery is manual and reuses the same authenticated Session; late success remains usable.
- Card fields are kept mounted across wallet/card switches and reconciliation. A late wallet response cannot hide a card the customer has started using. The card accordion starts open.
- The same public-key/locale Stripe instance is reused across dialog retries and reopenings. The cache is bounded to four merchant/mode keys and evicts rejected promises. Checkout Sessions, customer secrets and fields remain isolated per dialog; none are cached globally or in storage.
- A changing parent refresh callback no longer restarts the Session request. The actual request/customer identity and explicit retry still restart it.
- The payment button remains visible at the bottom of a long mobile form; 16px Stripe input text avoids unwanted mobile input zoom.
- No packages, analytics uploads, backend calls, database polling or Realtime subscriptions were added. Both Stripe Elements now initialize together instead of postponing card loading until the wallet check. Seven optional local Performance measures identify script, server Session, actions, card, wallet, confirmation and reconciliation time. Each name retains only the latest measurement and contains no identifiers, secrets or card data.

Existing eligible-ride SDK preloading is retained. Fulfillment remains server/webhook verified, and uncertain confirmations cannot be marked paid in the browser.

## Evidence and limits

Supabase logs inspected on 2026-10-23 contained 14 successful ride-checkout requests in the preceding 24 hours: average execution 1,108ms, maximum 2,112ms. These are Edge execution durations across payment actions, not end-to-end phone latency. The dominant reproduced bottleneck was the browser's sequential rendering path, so no speculative database changes were made.

A native Chromium check used the real official Endive SDK and the same isolated Sandbox Session with mocked app ride/API data. Each run used a fresh browser and the test environment's outbound proxy. Dialog-visible to card-input-visible:

| Build | Card iframe mounted after dialog | Card fields visible after dialog |
| --- | ---: | ---: |
| Previous rendering path | 28.66s | 42.99s |
| Parallel rendering, first check | 3.74s | 16.81s |
| Final build, independent confirmation check | 6.12s | 21.20s |

The measured reduction was approximately 51–61% in this environment. The proxy adds substantial external latency, the sample is small, and these figures are not a phone SLA or a prediction of live authorization time. The final run observed zero page errors and an enabled pay button before submitting.

An isolated 1.23 EUR **test** payment completed with the real SDK. Stripe independently returned Session complete/paid and a full successful test refund. No real app ride, customer balance or accounting row was changed. Session: `cs_test_a1G15BLJWpSfS8gn3UChjl1VcGzcVOsMdB7HmZL5KIWeXxWrvfbkQU22Kr`; PaymentIntent: `pi_3UTd0JPYGWX41ye82kjHn0Ze`; refund: `re_3UTd0JPYGWX41ye82PjR5Sd6`.

Validation: build configuration, lint, all 788 unit tests, TypeScript and the production build passed with Node 22. Twenty payment scenarios passed across Chromium and WebKit.

Regression coverage includes delayed actions and wallet readiness, the 12-second notice with retained input, no early confirm, late wallet detection while typing, hide/show preservation, shared Stripe instance with isolated Sessions, initialization retry, 320px layouts, keyboard/focus and an external bank overlay. Hardware Apple Pay/Google Pay and real issuer approval still require the phone check after publication; simulated wallet/3DS UI tests do not establish hardware approval.

## Inspecting a slow phone without recording personal data

In the browser Performance panel or developer console, inspect:

```js
performance.getEntriesByType('measure')
  .filter(entry => entry.name.startsWith('ride-payment:'))
  .map(({name, duration}) => ({phase: name, milliseconds: Math.round(duration)}))
```

These are local durations only. Compare cold and already-preloaded rides separately. `confirm` can include customer/bank interaction; it is not equivalent to network time. `session` in the isolated test was mocked and is not a backend benchmark. On a real ride it measures the authenticated Session request.

## Primary references

- https://docs.stripe.com/changelog/clover/2025-09-30/update-init-checkout-synchronous — mount Elements before awaiting actions to reduce render latency and display skeletons.
- https://docs.stripe.com/payments/elements/build-a-payment-page — combine Express and Payment Elements from the same Checkout instance.
- https://docs.stripe.com/js — reuse a Stripe instance for the same public key/options.
- https://docs.stripe.com/payments/payment-element — accordion layout and configuration.

## Publication

Pull main into Readdy and publish. Verify `/release.json` reports `2026.10.23-payment-performance.1`, then reopen the phone PWA. No Stripe Dashboard changes, live activation or new permission prompts are required.
