# Card payment flow and driver wallet — 25 October 2026

This release keeps online payments in TEST mode. It does not enable real charges, payouts or Connect.

## Every step and its authority

| Step | Component/service | Behaviour and recovery |
| --- | --- | --- |
| Ride is in progress | CustomerRidePayment / ride_payment_state | A scoped server read decides merchant eligibility, exact amount, environment and whether inline payment is available. Card payment stays disabled until trip_ended_at exists. |
| Safe preparation | RidePaymentElements / stripeCheckoutLoader | On an eligible ride, idle warm-up loads the lazy payment UI and official Stripe SDK. An unresolved client-secret promise can prepare the frames but cannot create or confirm a payment. Save-data users skip this early warm-up. |
| Driver ends the physical trip | end_ride_trip | Server records the end; the trip remains in progress while payment is unresolved. The customer does not confirm departure or arrival. |
| Register the payment | ride-checkout / begin_ride_elements_checkout | Authentication, customer, selected company, allowed merchant and fixed EUR amount are checked. A locked registered order and stable Stripe idempotency key prevent duplicate orders. |
| Bind Stripe customer and Session | ride-checkout / Stripe | Existing per-account/per-environment customer mapping is reused. The first customer can require an extra create/bind pair. One Checkout Session binds ride, customer, account, currency, amount and environment. A newly created valid Session does not need a redundant Stripe GET. |
| Open payment | RidePaymentForm | The same pre-mounted Elements open. Apple Pay or Google Pay appears only if configured and supported. Manual card entry is now always visible below available wallets, with no reveal tap. Reopening retains the same Session and frames. |
| Authorize | Stripe Checkout SDK / customer's bank | Exactly one confirmation at a time. Card input stays in Stripe's iframe. Wallet or bank authentication may take additional time outside the app's control. A client SDK success never marks the ride paid. |
| Authoritative confirmation | stripe-webhook / record_ride_stripe_snapshot | Signed webhook is checked. Server reads the bound Session with expanded PaymentIntent/charge; verifies identities, environment, EUR amount and fully captured payment; atomically settles ride/order and live ledger. Repeated/equivalent events retain audit history without adding money again. |
| Show the customer | CustomerRidePayment | Prefer the persisted database result. If the webhook receipt has not arrived, reconcile the same Session server-side. Lost responses do not start another charge. Return/PWA resume restores server state. |
| Show the driver | existing driver-filtered Realtime + exact previous-ride fallback | The persisted paid row clears only that completed ride. The pinned wallet shows “Платено онлайн” and +amount; it never credits based on the customer's click. A missed event uses the exact previous ride once, without idle payment polling. |
| Update the wallet | driver_day_summary | Existing daily aggregate now also includes received cash, POS card and net Stripe funds for completed LIVE rides on the Sofia day. Manual income reversals and Stripe refunds are deducted. Estimated fares, unpaid rides and test rides do not become wallet money. |
| Refund/cash alternative | server settlement/cancellation | Refund updates refresh the aggregate, including successive partial refunds. Before switching to cash, the same Session must be safely canceled/reconciled. Uncertain/processing payment stays blocked against duplicate cash collection. |

## Changes

- Manual card form remains visible alongside eligible wallets, including after late wallet detection. No extra card-selection click and no new payment Session for a method change.
- A compact wallet stays in the sticky header of both /driver/home and /driver/requests. Tap it for cash, terminal and online-to-company breakdown, or open the existing report.
- A server-confirmed online receipt shows +amount in Bulgarian EUR formatting. Its entry animation is suppressed when revisiting the same receipt in the same tab. The total always comes from the server aggregate; the UI never increments it locally.
- Sandbox receipts are visibly marked and never added to the real total. The wallet is collected ride turnover, not personal wages, cash in hand or money available for withdrawal.
- Home statistics and wallet share one cached aggregate. No new polling loop, realtime channel, SDK or dependency. Duplicate/stale terminal events do not refetch it; genuine settlement/refund changes do.
- Narrow-phone visual QA also fixed a pre-existing notification-permission banner that squeezed its text into a vertical column. This changes layout only.
- Additive database change preserves SECURITY INVOKER, existing driver/company authorization, MFA/RLS and existing API fields. Existing driver/date, request and reversal indexes serve the query.

## Connected-service evidence

Read on 25 October 2026. The current merchant is the main Leski account in TEST mode, not the separate sandbox account.

- Seven paid test orders in the preceding seven days had signed Stripe event records and matching persisted paid/completed rides. None entered the real payment transaction ledger. Three canceled test orders also had signed events.
- Current test configuration: cards and Apple Pay enabled; Google Pay disabled. leskikaruchka.com is enabled and active for both wallet domains. The test webhook is enabled and receives success, async, failed/expired and refund events.
- Live configuration read only: no payment-method domain, no webhook endpoint, Google Pay disabled. No live setting was changed.
- The connected Stripe tool exposes reading, but not updating payment-method configurations. Enable Google Pay in the appropriate test Dashboard, verify on Android, then configure it separately for live. No browser/account workaround was used.
- Last-24-hour Edge sample: 8 checkout responses at HTTP 200, mean 1351ms, p95 2639ms; 6 webhook responses at HTTP 200, mean 1300ms, p95 1577ms. These are small samples of server execution, not full phone or bank latency. This release removes a UI step and reuses existing warm-up; it does not claim measured faster Stripe/network processing.

## Validation scope

Unit, browser and database regressions cover manual-card availability with/without wallets; Google Pay UI dispatch; persistent iframes; duplicate confirmation and delayed responses; the pinned driver wallet; one aggregate refresh per paid event; exact previous-ride/owner scope; repeat partial refunds; test exclusion; receipt/reversal arithmetic; and tenant isolation. Browser wallet buttons are explicit test doubles, not an Android or Apple wallet certification. Physical device payment authorization and public-host rollout still require verification.

The full CI run also exposed a browser-fixture clock ordering issue: saved cookie consent could be a few milliseconds in the future relative to Playwright's fixed clock, unexpectedly opening the consent banner over the driver online control. The fixture now seeds a prior choice using the runner clock, and the GPS scenario checks that it remains valid. Production consent validation is unchanged.

## Before live

1. Enable Google Pay in the currently used TEST account. Test real Android Chrome/PWA with Google Wallet set up; card entry must work even if no wallet is available.
2. Register every actual live payment hostname and verify the wallet status. Current evidence covers only leskikaruchka.com in test mode.
3. Configure the live signing-secret/key pair and live webhook at https://rzjyvxmfqnnxglmgnvma.supabase.co/functions/v1/stripe-webhook. Enable success, async result, expiration/cancellation/failure, and refund events handled by the code.
4. Check live account charge readiness, then explicitly enable the correct merchant live configuration. Keep existing test receipts separate.
5. With separately signed-in customer/driver physical phones, verify card, Apple Pay, Google Pay, required bank authentication, declined card, network loss, reconnect, refund and duplicate-event handling. An approved small real charge/refund must wait for explicit live activation.
6. Verify the public PWA is serving the new release; pushing main does not prove a Readdy/hosting deploy.

Official references: https://docs.stripe.com/elements/express-checkout-element ; https://docs.stripe.com/payments/elements/build-a-payment-page ; https://docs.stripe.com/payments/payment-element/best-practices ; https://supabase.com/docs/guides/realtime/postgres-changes .
