# Card payment settlement audit — 24 October 2026

Online payment remains in TEST mode, scoped to the enabled Leski merchant and explicitly allowlisted customers. This release does not activate live charging.

## Evidence from the connected services

The audit matched the latest successful Sandbox payments across Stripe API events, the private webhook event log, registered orders and persisted ride records. Both completed-event and PaymentIntent-event deliveries were acknowledged. The registered amounts, currencies, order identities and environments agreed. Earlier successful test rides also had matching webhook records. No test ride entries were present in the real payment transaction ledger.

Explicit server reconciliation records were distinguished from signed webhook event records. Detailed transaction identifiers and amounts are deliberately omitted from this repository report.

The driver gets the persisted ride row through the existing driver-filtered Postgres Changes subscription. The table is in `supabase_realtime`; SELECT policies scope reads to the assigned driver, owning customer or authorized company/super administrator. Signature verification, account/environment/customer/order/amount/currency checks and locked settlement remain server-side. A client SDK success alone cannot settle a ride.

These are observed connected-service records. Browser tests below simulate the transport and persisted result; they do not claim observation of the user's physical driver screen.

## Changes

- Reuse the webhook-confirmed customer payment state before requesting Stripe reconciliation.
- A scoped server reconciliation of an already settled order returns the database receipt without a Stripe GET or another settlement write.
- Retrieve the Session with `payment_intent.latest_charge` expanded: one Stripe read instead of sequential Session and PaymentIntent reads. Unexpanded responses retain the existing fallback and all binding checks.
- Repeated/equivalent settlement snapshots retain event audit records but do not rewrite unchanged ride/order rows or generate extra row-change notifications. Refund changes still update the ledger and ride normally.
- Both driver panels reuse the exact terminal Realtime snapshot. A missed event uses one bounded receipt read; no idle payment polling is introduced. Notices disappear on a new ride or identity change. Late old events cannot close the next ride's payment dialog, and slow reads cannot overwrite a newer refund.
- Revision and resume refreshes share in-flight customer state reads instead of canceling/restarting them. Existing Stripe warm-up and mounted card/wallet frames are retained.

## Measured baseline and limits

The preceding 24-hour Edge log window contained 28 successful checkout calls (mean 1289ms, p95 2845ms), 39 successful webhook calls (mean 1318ms, p95 2043ms), and one webhook 503. These are server timings, not card-entry or bank-authentication latency. Removing requests is deterministic; a new physical-device end-to-end latency measurement is still required before making a live performance promise.

The existing failed webhook requires identifying its event/retry outcome; a successful aggregate is not proof that every historical delivery recovered.

## Validation

- Unit regressions: exact ride/owner/driver scope, missed events, late responses, refund races, expanded response binding, settled response authorization, and no redundant Stripe reconciliation.
- Browser regressions: Chromium and WebKit, both driver panels, card/wallet, bank authentication overlay, timeout recovery, PWA resume, lost Realtime fallback, next-ride isolation and request counts.
- SQL regressions: repeated event, distinct equivalent event and old open snapshot leave settled rows/timestamps unchanged while retaining all event audit entries; existing test isolation, refunds and concurrency suite must pass.
- Build, lint, types and Edge type checking are required before release.

## Before live activation

Verify the live merchant's charge readiness, live key/signing-secret pair, enabled event destination and domain/wallet registration. Run an approved small live payment and refund with the customer and driver on separate physical phones, including bank authentication and reconnect. Verify exact company reporting and no duplicate cash collection. Activate the live merchant explicitly only after these checks. Existing test receipts must remain test receipts.
