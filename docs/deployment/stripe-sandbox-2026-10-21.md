# Stripe: one legal operator and city divisions

The owner confirmed on 2026-10-21 that Leski is one legal entity. Its existing
city tenants are operating divisions, not independent Stripe merchants. One
Stripe account belongs to the root; city orders retain their own `company_id`,
tariffs and report scope. Independent partner companies will later use Connect.
Do not authorize payments by company display name or Stripe metadata alone.

## Verified problem

The deployed sandbox webhook called a nonexistent `handle_payment_succeeded`
RPC, producing HTTP 500s. Its CLI fixtures contained USD 20 and arbitrary ride,
driver and company UUIDs. Those are not valid paid taxi rides. A green webhook
delivery is not proof that a customer paid a particular fare.

## This change

- Tracks the webhook source in Git and preserves raw-body Stripe signature
  authentication. The only accepted Stripe account is the dedicated Leski
  sandbox, with `livemode=false`.
- Uses private sandbox merchant, order and event tables. It has **no write path**
  to `taxi_requests`, `payment_transactions`, `driver_money_entries`, receipts,
  notifications or customer balances. No live-payment switch is added.
- One configured root authorizes its own direct city divisions. Registration is
  service-only and binds the expected EUR minor-unit amount before payment to
  a Stripe PaymentIntent or hosted Checkout Session. Metadata cannot register
  an order. Existing cash/card collection RPCs, MFA and tenant RLS are unchanged.
- Records each event once under a transaction lock, then serializes distinct
  events for the same order. Late failures cannot erase captured money; older
  refund events cannot reduce cumulative refunds. A repeat refund delivery can
  observe newer totals without being mistaken for an event-ID collision.
- For Checkout/refunds, retrieves the current underlying PaymentIntent using
  the sandbox key and verifies its account and charge/session binding. Stripe
  or database outages remain retryable HTTP 503 responses. Successful storage
  replies explicitly say `applied_sandbox_only`; unrelated old CLI fixtures say
  `ignored_unregistered_payment`.

## Deployment and test procedure

1. Run native disposable Supabase tests, including 12 concurrent event copies
   and concurrent full-refund/failure/partial-refund events. No outbound push
   is sent by the disposable database. Run TypeScript/Edge/unit checks.
2. Apply the additive migration. Configure the verified sandbox account/root
   relationship through an explicit operator DML action, not invented IDs in
   a migration. Keep real Stripe/account/company data out of CI fixtures.
3. Deploy `stripe-webhook` with `verify_jwt=false`; its own Stripe signature is
   the authentication. Reuse the existing server-only `STRIPE_WEBHOOK_API`
   signing secret and `STRIPE_API_KEY`. Never put these in VITE variables.
4. Subscribe the sandbox destination to `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed` and `charge.refunded` alongside its
   existing PaymentIntent/refund events. Do not change the live account.
5. Register a private sandbox order with the exact Checkout ID and both session
   metadata and `payment_intent_data.metadata.leski_payment_order_id`. Completing
   that Stripe-hosted sandbox session must update only its private order.
   Verify raw-signature failures, duplicates, old unrelated fixtures, refunds,
   and unchanged counts in all real financial tables.

## Remaining product integration

This is the safe sandbox foundation, **not a published customer payment flow**.
Payment timing (at booking or at ride end) must be settled before wiring customer
Checkout and cancellation/refund behavior. The driver copy is exactly
**„Платено онлайн“**, only after confirmed full payment; choosing “online”, a
redirect, an authorization or a partial capture does not qualify. Online money
belongs to the company and must not create a second driver cash/card receipt.

Future Connect routing will replace the merchant selector for independent
partners. It must retain the same ride/company/account/environment/amount
binding; legal merchant, charge/refund liability and payout policy need a
separate Connect decision before live onboarding. No Connect accounts, fees,
tax registrations or public legal details are fabricated here.

Official references: [Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment),
[webhooks](https://docs.stripe.com/webhooks),
[metadata](https://docs.stripe.com/metadata),
[sandboxes](https://docs.stripe.com/sandboxes),
[Connect charges](https://docs.stripe.com/connect/charges),
[merchant of record](https://docs.stripe.com/connect/merchant-of-record).
