# Active route reuse and Routes request budgets

The tracking screens keep the accepted road geometry while the vehicle follows
it. GPS fixes update marker motion, remaining distance, approximate arrival time
and driver instructions locally. Travel distance and elapsed time alone no longer
trigger another Google Routes request. The layout and buttons are unchanged.

A new route requires three independent GPS fixes, accuracy at most 50 metres,
more than 50 metres (or twice the reported accuracy) off the road, and at least
10 seconds of confirmed deviation. Reroutes are spaced by at least 30 seconds;
each mounted screen makes at most three attempts per active leg. Stale positions
and hidden screens do not request routes. Failed requests retain the last route,
use bounded retries and respect the server's `Retry-After` response.

Remaining distance and arrival time are estimates derived from progress along
the original route. They do not refresh live traffic, determine trip completion,
change a booking price or prove actual kilometres driven.

## Server limits

Migration `20261004092612_route_request_budget.sql` creates service-only private
counters and settings. `google-routes` validates the authenticated participant,
active request, route phase and destination before reserving an API attempt.
Legacy clients without a request ID are associated with their active request.
Denied reservations never reach Google. Missing budget storage fails closed.

| Setting | Initial limit |
| --- | ---: |
| Total Google Routes attempts per day | 120 |
| Portion of that total reserved for new booking quotes | 20 |
| Attempts per user per day | 60 |
| Attempts per active request across participants, screens and reloads | 10 |

The quote reserve is included in the 120 total. Other route calls stop at 100.
Daily counters reset at midnight in `America/Los_Angeles`; the request counter
lasts for the request's lifetime. A transaction advisory lock makes reservations
atomic. Attempts remain charged to the internal budget even if Google fails,
because the external request may already have been processed. The lock is
released before the external HTTP request.

These limits cover only calls made through this project's `google-routes` Edge
Function. Keep Google Cloud quotas configured separately. They do not cover map
loads, Places, Geocoding or other callers and do not guarantee a zero invoice.
No new service or package was added. No Google route geometry is stored by this
migration, and GPS collection and database write frequency are unchanged.

## Release and verification

Apply the migration before deploying `google-routes`. Retain its existing
`verify_jwt: false` setting: the handler authenticates bearer tokens with
`authorize` and Supabase Auth `getUser` before accessing the service client.
Deploy the entrypoint plus the existing `_shared/auth.ts`, `serviceArea.ts` and
`pricing.ts` dependencies.

Publish the updated frontend from GitHub using Readdy Pull/Publish. Older
frontends still work with the server checks but their frequent reroutes can
exhaust the shared request limit; frontend publication is part of the release.

Validation: `npm run check` passed lint, 244 tests, TypeScript and the production
build. Edge code passed an additional strict type check. Live SQL tests ran in a
rolled-back transaction and covered participant and phase checks, legacy request
inference, shared request/user/global limits and the quote reserve. No test
users, trips or counter changes remained. Supabase advisors reported no new
findings from this change; pre-existing findings remain separate work.

In a simulated 20-minute drive on the known road, the two tracking screens made
two initial live-route requests in total. Booking quotes, a full-route context
preview, phase changes and confirmed deviations are separate requests. This is
a regression scenario, not a measured production billing result.
