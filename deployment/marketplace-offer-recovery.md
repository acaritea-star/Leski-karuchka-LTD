# Marketplace seam review

Reviewed against main `1b60ec288890b72bc222d89a7410ba66eb34ffba` and the live database on 12 October 2026.

## Confirmed gaps and changes

- Incoming reconciliation used the assigned-ride socket's health instead of the private offer socket's health. Home and requests now reconcile every 30 seconds when Broadcast is connected and every eight seconds when it is unavailable. Active ride reconciliation remains independent.
- Multiple hints arriving while a read was in progress could disappear into the earlier snapshot or repeatedly invalidate the same query. A bounded serial drain coalesces the burst into one trailing read and stops on account teardown.
- A late acknowledgement of an old driver's offline write could stop the next driver's GPS. Scoped stop checks the tracked driver ID before affecting the shared watcher.
- Refusals were hidden only after the server's 50-row limit. They now leave the incoming list before that limit and are excluded from push recipient selection, including durable worker retries. Another driver's refusal cannot hide the offer for its peers.
- A cancelled common offer without an assigned driver was attributed to the provisional quote carrier in dashboard and accounting totals. Company reports now include legacy operator orders and assigned marketplace orders; platform-only cancellations remain in request/outcome evidence without being counted as a carrier's failed trip. Completed fares and money entries are unchanged.
- A same-route new order could reuse the quote already bound to the cancelled request. Reset invalidates every class quote and obtains a fresh quote/key, while category switching and temporary availability recovery still reuse the existing route.

## Verification

Focused regression tests reproduced the old fallback, hint burst, cross-account GPS and repeat-order failures before their corrections. The SQL suite additionally verifies both carriers' worker leases, refusal filtering and skipped push retries, preservation of platform cancellation evidence, and inclusion of cancellations after assignment in the winning carrier's report.

All fixtures remain confined to disposable localhost Supabase. Browser tests block external APIs. No synthetic production bookings, real email or Google test requests are needed. The rollback file restores the exact four previous live function definitions and leaves all rows and existing grants intact.

507 unit tests, lint/build, Deno checks and 38 Chromium/WebKit scenarios passed. Database lifecycle, overlapping acceptance sessions, refusal delivery checks, attribution checks and both rollback packages passed in GitHub Actions. One initial run failed before SQL execution because the mail test container's host port was occupied; the failed job alone was rerun successfully.

The live migration is `20261012184648_marketplace_offer_recovery`. Retrieved definitions match the tested migration and all four ACLs match the pre-change snapshot. Read-only calls for an actual driver and company admin succeeded. Existing security advisor findings are unchanged.

## Publication and remaining boundaries

The public release endpoint still returned `2026.10.12-driver-invitation.1` during this review. GitHub and database deployment must be followed by Readdy publication of the matching frontend, then an actual foreground-device smoke check. Public-site publication cannot be inferred from a GitHub merge.

The service-fee billing flag is still disabled. Documented 8–12% terms do not mean money is being collected or settled. Browser/PWA background GPS remains OS-dependent. Fare records, declared cash and externally reconciled cash are separate evidence; an unrecorded outside-platform journey cannot be proven from an absent record. Those boundaries remain material to any paid-product claim.
