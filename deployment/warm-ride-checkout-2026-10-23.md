# Prepared ride checkout — 2026-10-23

Release: `2026.10.23-warm-checkout.1`. Stripe test environment only; live remains disabled.

The bottom-right badge is Stripe's Sandbox testing assistant. Disable it through the official `developerTools.assistant.enabled: false` constructor option, without CSS overrides.

An eligible customer's active ride prepares the Stripe instance and Payment/Express Checkout iframes during idle time. An unresolved client-secret Promise lets the SDK download UI resources without a payment Session. The existing authenticated checkout request is still allowed only after the driver ends the trip and freezes the fare. It then resolves that same Promise. Read-only preparation creates no order and cannot confirm money.

The customer opens the prepared form explicitly using the card-payment button. Closing/reopening keeps the same Session, iframes and entered fields. The hidden form is inert and invisible, with no dialog role, focus trap, scrim or scroll lock. Merchant/mode/fare validation, recovery, wallet/bank overlays and server/webhook-only settlement remain mandatory. The preparation is scoped to the user/ride/merchant and released on disposal, including safe effect replay. No client secret is saved globally or in storage.

The existing state RPC adds only public account/key/mode configuration, only to the eligible owning customer. Driver/staff state access remains available without this preparation. No new endpoints, packages, Realtime subscriptions or polling loops. Idle preparation skips offline/Save-Data connections. The lazy payment chunk grows by approximately 1kB before gzip.

## Evidence

Before source recovery, build config, lint, TypeScript, production build, **797 unit tests in 113 files** and **22 payment scenarios across Chromium and WebKit** passed. Tests cover zero pre-end checkout requests/confirmations, long pending preparation, role/merchant isolation, hidden UI, exact iframe retention, reopening, timeout/retry, uncertain payments, 320px layout and bank overlays. The final button wording was checked for reopening in both engines. CI rechecks the committed source.

Real Stripe Endive SDK with the same isolated unpaid Sandbox Session, native Chromium through the test proxy: **20.462s cold vs 8.056s prepared** from secret availability to card/actions ready (about 61% reduction). The prepared form was invisible during download. Initial script download is excluded from these numbers and happens during the ride in the warm case.

The final app integration check used real Stripe iframes and mocked app ride/API data. It measured **9.531s from synthetic arrival to card ready**, **1.777s from tap to visible card fields after readiness**, and **0.670s for reopen**. There were no pre-arrival Session requests, no dialog or scroll lock during preparation, one Session request after arrival, unchanged frames/input on reopening, zero page errors and zero assistant frames. Card data was entered only into Stripe's real test iframe. No payment was submitted or charged. The 1.23 EUR isolated Session was unrelated to a real app ride.

Recent successful production Edge action executions averaged 1.264s (23 requests, max 3.427s). The browser check mocked that API, so its timing is not a server or phone SLA. Preparation moves work before the tap; a customer tapping immediately on arrival, starting cold, using Save-Data or a slow/offline connection can still see honest loading/recovery. Issuer approval and hardware Apple Pay/Google Pay timing require a phone check.

The database migration was applied and verified: trip-end gate and privileges preserved, five owner-scoped reads returned only intended public fields, and security-advisor findings were unchanged. The prior RLS warning concerns the PostGIS reference table. The migration also passed isolated PGlite owner/driver/foreign/anonymous/inactive/pilot checks. Postgres regression fixtures assert that fully configured unfinished rides still cannot create checkout orders.

## Publication

Pull main into Readdy and publish, verify `/release.json` shows `2026.10.23-warm-checkout.1`, then reopen the phone PWA. No Stripe Dashboard or permission changes are needed. The added RPC field is backward compatible with the previous frontend.

References: https://docs.stripe.com/sdks/stripejs-testing-assistant and https://docs.stripe.com/js/custom_checkout/init (client secret Promise), https://docs.stripe.com/js (shared instance).
