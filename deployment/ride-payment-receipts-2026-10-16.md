# Ride payments and expense evidence — 16 October 2026

Completing an in-progress ride opens the agreed fare with two confirmation
buttons: received cash or received on the card terminal. The backend reads the
fare from the assigned ride; the browser cannot replace it. Card confirmation is
a driver declaration after using an external terminal, not an integrated charge
or proof of a bank settlement. No new payment processor or dependency is added.

The exception flow records unpaid or partial payment with a reason. It closes
the ride safely without inventing income. Later receipts may cover the remaining
fare; their combined active amount cannot exceed the agreed fare. An initial
exception stays in history even when the debt is subsequently paid.

## Financial invariants

- One transaction stores the checkout, completed ride, outcome and positive
  income. Zero receipts create no phantom ledger entry. UUID retries and row
  locks prevent duplicate posting, including competing devices.
- A browser operation is persisted before sending it. A lost reply is reconciled
  using the same immutable receipt and matching completed ride. Status alone is
  insufficient. Uncertain writes are never automatically replayed.
- The recovery component remains mounted after Realtime removes the active ride
  and restores an uncertain checkout after reload. Account/driver changes mount
  a new scope. A saved command cannot be silently replaced by another choice.
- Cash, card and unknown historical tender are separate. Existing amounts and
  unknown methods are never backfilled as received cash. Report v2 remains
  compatible with old readers; new fields validate against its existing totals.
- Company handover/verification is separate and does not add a second income.
  Corrections append reversals on their actual posting date. Existing legacy
  linked-income and company-evidence rules remain in place.

## Expense evidence

An expense is posted first. A separate dialog uploads at most three files to the
existing entry. Failed uploads/retries never call a money-writing endpoint.
Only JPEG, PNG, WebP and PDF up to 5 MiB each are allowed. The bucket is private;
metadata, file paths and permissions are bound to the expense, company and owner.
Owners can upload immutable reserved paths. Finalization verifies actual Storage
metadata. No client overwrite/delete is allowed. Company admins can view only
finalized evidence for their company; another driver, company or a customer
cannot read it. All new endpoints and tables enforce staff MFA.

Documents load on demand. Downloads use authenticated Storage requests and Blob
URLs, revoked when the dialog/account scope closes. Metadata queries are bounded
to three files. The existing backup utility enumerates all buckets automatically.
No new polling, Realtime channels or Broadcast traffic is introduced.

## Dashboard language

Operational health shows human-readable problems, a next action, Bulgarian
seconds and counts. Current GPS freshness is distinguished from historical
24-hour failures. Raw operation names/budget counters are secondary details for
super administrators. The query keeps its existing visible-only one-minute rate.

## Safe release sequence

1. Verify unit/browser checks, full disposable Supabase SQL/RLS tests and the
   dedicated concurrent checkout test before applying production DDL.
2. Apply `20261016192953_ride_payment_checkout_receipts.sql`. Its private
   `ride_payment_required` flag starts **false** so the currently published
   frontend can continue finishing rides during the deployment interval.
   The atomic checkout RPC and all evidence/MFA protections work immediately.
3. Pull the packaged commit from GitHub and Publish in Readdy. Verify the public
   `/release.json` reports the matching `ride-payment-receipts` release. Confirm
   the cash/card completion dialog is visible. Never create production financial
   records as a deployment test.
4. Only after the matching frontend is public, set the private flag with:

   ```sql
   UPDATE private.app_security SET ride_payment_required=true WHERE singleton;
   ```

   The SQL trigger then rejects direct client status-only completion. Already
   completed historical rides are untouched. Old open tabs must refresh to use
   the new checkout. The RPC has its own authentication, assignment, company,
   fare, MFA and idempotency validation irrespective of this deployment flag.

For a frontend rollback, disable the flag before reverting the frontend. Preserve
all ledger/checkout/evidence tables and files; do not undo real financial history.
The gate flag is intentionally private and cannot be changed by a browser user.

## Verification

The new rollback-only SQL suite covers cash/card/unpaid/partial receipt posting,
exact retries, tampering, top-ups, overpayment, separate cash balance, zero-effect
company verification, proof limits, immutable metadata, Storage policies,
foreign-company/driver/customer access and missing MFA. The concurrency suite
uses actual separate PostgreSQL connections in disposable localhost Supabase.
Browser scenarios cover lost responses, reload without an active ride, small
viewports, private-file retry without another expense and readable health alerts.
The real Auth/TOTP integration also uploads, finalizes and downloads actual private Storage bytes, checks public/aal1 denial and verifies overwrite/delete cannot change the original.
Local PostgreSQL WASM is an additional syntax/logic check, not a substitute for
the full Supabase CI integration.

References: Supabase private buckets and Storage access control:
https://supabase.com/docs/guides/storage/buckets/fundamentals
https://supabase.com/docs/guides/storage/security/access-control

Production schema applied with Supabase migration `20261016192953` on 16 October
2026. The repository filename follows the server-assigned version. Read-only
verification confirmed a private 5 MiB bucket, RLS on both new tables and staff
MFA enforcement. The completion gate was staged off pending frontend publication.
