# Marketplace dispatch and category management

The customer chooses pickup, destination and service class. Eligible drivers from all partner companies within their configured dispatch radius receive the offer. The first successful database acceptance wins. Vehicle categories, tariffs, drivers and financial reports remain owned by the accepting carrier.

## Evidence and design decisions

- The two real test drivers belong to different operators. One car is Eco and the other is Standard; these map to the common Standard class. The original dispatch predicate, push recipients and frontend filters all enforced the quoted company's ID. Changing just the frontend would leave two backend barriers.
- A selected Comfort category with no active Comfort car cannot be fulfilled by a Standard car. The customer now sees shared classes and fresh aggregated availability; unavailable classes cannot be booked.
- New companies start with Standard. The vehicle editor previously only listed existing categories. Company admins now add/edit their own category name, class, capacity, multiplier and active state, including from an open car form without losing entered car details.
- The live companies do not all have a 5 km radius: the reviewed configuration contains both 5 km and 9 km. Dispatch respects each firm's saved value. A radius is straight-line distance from fresh driver GPS to pickup; it is not a driving ETA or a municipal transport permit.

## Primary-source research

- [Uber Marketplace Matching](https://www.uber.com/us/en/marketplace/matching/) describes short batching and system-wide wait-time optimization. It does not establish that broadcasting everything is always optimal.
- [Uber Trip Radar](https://help.uber.com/en-GB/driving-and-delivering/article/trip-radar-feature?nodeId=c4631147-f3c7-4ea4-aadc-311487206bf5) documents nearby offers visible to multiple online drivers. Our initial model uses shared offers and atomic acceptance, without claiming Uber's full matching algorithm.
- [PostGIS radius queries](https://postgis.net/documentation/tips/st-dwithin/) recommends ST_DWithin with spatial indexes. The existing driver_locations geography GiST index is retained; the marketplace uses one spatially bounded readiness scan instead of one scan for every registered company.
- [Supabase database subscriptions](https://supabase.com/docs/guides/realtime/subscribing-to-database-changes) recommends Broadcast for scale. [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes) checks each subscriber's access for each change. Drivers therefore get targeted private Broadcast hints, not global request-table subscriptions.
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) requires channel RLS and private:true. A driver can read only driver-offers:<own auth UID>; there is no new client send policy. Hints contain only request_id. The subsequent RPC rechecks current eligibility and returns the driver's own price.
- [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html) and [transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html) support request-then-driver row locking, rechecking after waiting, and unique active-ride constraints. Local concurrent sessions prove overlapping locks rather than inferring a race from Promise.all.
- [Uber pricing API](https://developer.uber.com/docs/riders/references/api/v1/requests-estimate-post) distinguishes fare ranges, fixed offers and metered taxis. This technical release preserves the project's existing fixed quote ledger; it does not certify a fiscal taximeter or alter transport-law obligations.

## Price and ownership

One Google route measurement creates a quote per available shared class, with a saved tariff offer for each eligible carrier/category. Each offer uses the same raw metres and seconds and existing exact decimal arithmetic, with one final rounding to cents. The customer sees the minimum/maximum of those offers before ordering. The driver sees its own carrier's amount before acceptance. Acceptance binds company_id, vehicle_type_id, fare_breakdown and estimated_price atomically to that saved offer. Completed trips and reports use the winning carrier and amount; another driver cannot see the foreign completed trip.

Quotes expire after two minutes. Availability and qualification are rechecked at creation and acceptance. If another eligible carrier/category appears before submission without a saved tariff, creation fails clearly and the customer must explicitly refresh the quote. It cannot accept at an unquoted price. No guessed tariff, silent surcharge or client-written price is permitted.

The current service-fee billing flag is unchanged. This release does not collect new commission or email actual users.

The complete offer matrix stays in the owned server quote for evidence. Route responses and driver incoming lists contain only the range and the relevant fare; assignment removes the unused matrix from the active ride. Every active-ride refresh therefore avoids retransmitting all firms' prices.

## Delivery and recovery

The database produces one durable push/outbox record and one targeted hint per eligible driver. One root-level account-scoped subscription survives switching between driver pages. Teardown/rejoin is serialized for StrictMode and fast reauthentication; late callbacks from an old account are ignored. Broadcast failure does not roll back a durable booking: bounded reconciliation reads recover missed hints. Acceptance/cancellation also invalidate the original recipients' lists. Active-ride updates stay filtered to the assigned driver. Driver caches are keyed by auth UID so two accounts on one phone cannot share an incoming-request cache.

Browser/PWA background GPS and push permissions remain device-dependent. One phone with an installed PWA and a background Safari account is not equivalent to two independently active driver devices. GPS freshness, document readiness, busy/offline status and category remain enforced.

## Verification and release

All SQL fixtures run only against the disposable localhost Supabase. Tests cover two carriers receiving one request, individual tariff display, remote-driver exclusion, ownership and fare rebinding, completed-trip isolation, forbidden category writes, double acceptance, one driver/two rides, lost acknowledgements, cancellation and expiry while acceptance waits. Browser fixtures block external APIs. The live project is inspected read-only before changes; no synthetic rides or drivers are inserted in production.

Apply the additive marketplace migration only after database regression passes, deploy the backward-compatible google-routes function, then publish the matching frontend. Legacy single-company quotes retain their old eligibility and financial semantics. GitHub merge alone does not publish the external Readdy site; verify release.json after its publish step.

The rollback package restores the exact pre-release functions and policies. The service_class column and index can remain as harmless metadata after rollback; no profiles, journeys, receipts or ledger rows are deleted.

### Applied backend and checked release

- Live migration: `20261012151552_marketplace_dispatch`; Google Routes: version 12. All five retrieved deployed function files match the tested source. Existing custom authentication and legacy single-company requests are preserved.
- GitHub Actions passed database lifecycle tests, real overlapping acceptance sessions, private Broadcast delivery/read isolation and the rollback package. The checked source also passed 500 unit tests, lint, build, Deno checks and 38 Chromium/WebKit browser cases. A final category-response compatibility check brings local unit coverage to 501 passing cases.
- Read-only checks with both actual driver identities successfully call the incoming-request RPC. Both were offline during the check, so zero offers is expected. A customer can read aggregated availability; anonymous callers cannot, and only the server can obtain candidate tariff snapshots.
- Advisor comparison introduced no new security findings. Existing extension placement, extension-table RLS, helper-function grants and disabled leaked-password protection findings remain separate follow-up work; this change is not a full security certification.
- Readdy must pull the matching GitHub revision and publish. Check `/release.json` for `2026.10.12-marketplace-dispatch.1`, then test Standard with two verified, online, available drivers on independently active devices and fresh GPS. Both should receive the shared offer; one accepts, the other's offer disappears, and each company's history contains only its own completed trips.
