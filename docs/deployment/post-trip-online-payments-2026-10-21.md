# Payment after arrival

One legal merchant: `acct_1USiOkPYGWX41ye8`. City companies inherit the root
through `companies.parent_company_id`; the name does not grant payment access.
Independent firms remain cash/POS until a separate Connect integration.

`end_ride_trip` records the assigned driver's server timestamp and frozen agreed
fare. The ride retains its active slot until financial completion. The client
does not confirm the start. The payment button is visible but disabled before
arrival. Hosted Checkout avoids loading a Stripe SDK into the app. Apple Pay is
shown by Stripe only when available for the account, browser and wallet.

The authenticated `ride-checkout` function validates the live Auth user, active
profile, staff MFA and request budget. It creates a service-registered order with
the ride/customer/company/merchant/amount/currency bound before Stripe. A single
active order and deterministic Stripe idempotency key survive repeated clicks,
tabs and lost responses. Redirects use the canonical `/customer/home` route.

The live branch of `stripe-webhook` verifies the raw-body signature, rejects sandbox
and foreign account events, retrieves the current Checkout and PaymentIntent/charge, validates
all bindings and records a transaction only after full capture. Authentication,
processing or delayed payment never means paid. Webhook-before-attachment and
Stripe/database errors return 503 for retry. Reconciliation from an authenticated
return or refresh uses the same database settlement and cannot manufacture paid.

Cash/POS, Checkout reservation and webhook settlement take the same ride row lock.
Switching to cash first expires the Checkout and reconciles its actual payment;
unresolved processing remains locked. The system does not promise payment without
network confirmation. A lost creation response can be recovered using the same
key; unknown orders older than Stripe's idempotency retention require operator
review and must never be cleared on the client's assertion.

Online proceeds are company transactions, separate from `driver_money_entries`.
Refunds are monotonic delta postings with their own posting dates. Accounting
shows online received/refunded/net separately from driver cash, and fully paid
online rides do not appear unpaid or offer manual income entry. Public clients
and company administrators cannot write provider confirmations.

## Deployment and activation

1. Run migration/role tests against disposable Supabase, then apply migration
   `20261021174851_post_trip_stripe_payments.sql`. No merchant is enabled by DDL.
2. Set the restricted **live** key as `STRIPE_LIVE_SECRET_KEY` in Supabase's secure
   Edge Function secrets. It needs account-read, Checkout create/read/expire,
   PaymentIntent read and charge/refund read. The runtime verifies the account
   identity and `charges_enabled`; the existing sandbox key cannot be substituted.
3. Deploy `ride-checkout` (JWT checked in its body) and `stripe-webhook`
   (raw-body Stripe signature, JWT disabled). Keep the existing webhook URL and dispatch signed sandbox events to its isolated sandbox ledger.
4. Create a live Stripe event destination for
   `https://rzjyvxmfqnnxglmgnvma.supabase.co/functions/v1/stripe-webhook`.
   Subscribe to Checkout completed/expired/async success/failure,
   PaymentIntent succeeded/processing/payment_failed/canceled, charge.refunded,
   and refund created/updated/failed. Store its signing secret exclusively as
   `STRIPE_LIVE_WEBHOOK_SECRET` in Supabase.
5. Verify account activation and card/Apple Pay availability in Stripe. Authenticated
   super admin can POST `{"action":"readiness"}` to `ride-checkout`; both account
   readiness and webhook-secret presence must pass before enablement.
6. Explicitly register the reviewed Leski root company in
   `private.ride_stripe_merchants` with that account and `enabled=true`. Review
   membership of all city divisions. Do not enable any independent firm's row.
7. Pull the tested main revision into Readdy and publish. Check the deployed
   release manifest. Perform a real-device wallet test with the owner; no live
   charge is made by deployment or automated tests.

On 2026-10-21 the live Stripe API returned no webhook endpoints. Its default
configuration had card and Apple Pay preference on, but `available=false` for
both. The connected account reader did not grant account-details permission.
Supabase CLI did not have an access token for setting secrets. These are external
activation requirements, not evidence that live payments already work.

## Validation

Pure orchestration tests cover signature/environment, immutable fare, session and
payment identity, partial capture, processing, safe expiration, refunds and retry.
Rollback SQL covers role/tenant checks, branch eligibility, idempotent arrival and
settlement, cash races, double-income prevention, refunds and accounting. Browser
tests cover the disabled-to-enabled client button, arrival at both screens,
return after payment, no start confirmation, and a missed realtime event.


## Deployment record

On 2026-10-21 migration `20261021174851_post_trip_stripe_payments` was applied.
The existing `stripe-webhook` URL now serves version 4, with independent raw-body
signature verification and isolated storage for sandbox and live events.
`ride-checkout` version 1 was deployed with authentication enforced in its body.
Smoke checks returned 405 for webhook GET, 400 for an unsigned webhook POST, and
401 for an unauthenticated checkout request. The sandbox endpoint includes
`checkout.session.expired`. No live merchant is enabled and no live payment was
made. A registered 1.23 EUR sandbox Checkout awaits the owner's phone test; an
open Checkout is not evidence of a successful payment.

Database role checks confirm RLS on all three new private tables, no direct reads
for anon/authenticated, and no authenticated ledger inserts or service-only RPC
execution. Advisor findings for the new private tables are informational deny-all
RLS notices; the existing PostGIS/public-schema and Auth advisories remain.
