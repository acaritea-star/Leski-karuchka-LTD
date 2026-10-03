# Reliability audit — 2026-10-03

Project: rzjyvxmfqnnxglmgnvma. The audit used live catalog/aggregate health reads and synthetic integration fixtures inside BEGIN/ROLLBACK, with lock_timeout 5s and statement_timeout 30s. No fixtures or notification jobs were committed; pg_net HTTP work only begins after commit (https://supabase.com/docs/guides/database/extensions/pg_net).

## Observed health

At the inspected snapshot both maintenance jobs were active: dispatch every 10 seconds, maintenance every minute. The previous hour had 420 successful runs and zero failures; zero overdue pending requests and zero processing jobs with a lease overdue by more than one minute. Provider jobs showed 14 sent and 13 skipped for NO_SUBSCRIPTION. The 27 retained worker HTTP responses were 200 without timeout. Sent means provider acknowledgement, not confirmed display on a handset.

No duplicated active driver or customer assignments were found. No example.invalid fixture profiles remained after rollback.

## Database verification

The complete core, cash/geographic/push and reliable_dispatch suites passed against the current production schema, including Bulgaria guards. The core fixture now saves valid GPS before going online, matching the live availability guard.

Checks cover quote ownership/retry, cash-only booking, lifecycle/price integrity, long-trip preservation, 4.9/5.1km dispatch boundary, Sofia versus Tarnovo/Pleven, stale/imprecise GPS, driver/vehicle/company availability, expired requests, immutable identities, private outbox privileges, invalid/replayed/expired leases, durable retry and retry limit. Competing-acceptance scenarios confirm the original driver retains a ride, a busy driver cannot accept a second ride, an available contender can accept, and even a privileged second assignment hits the active-driver unique index. Live catalog confirms request/driver row locks in the accept RPC and partial unique indexes for active drivers/customers.

These contender scenarios were sequential in one rollback-only connection, not a simultaneous two-session stress test. No real driver/customer requests or push messages were sent by the audit.

## Frontend corrections

- Customer polling permits one read in flight, has a 10-second deadline, cancels on cleanup, skips hidden tabs and discards updates for other requests. Older snapshots and backwards lifecycle transitions cannot overwrite newer Realtime state; identical snapshots retain their object identity.
- Online/offline mutations capture the explicit target once, so a retry after a cache refresh cannot invert the user's original intent. Both driver screens use the confirmed row and duplicate-click protection.
- Failed acceptance/lifecycle acknowledgements recheck the active request, covering a server success with a lost response. The requests panel refreshes its feeds after a Realtime reconnection.

Validation: lint, TypeScript, production build and 143 tests pass. New integration tests reproduce slow pending poll versus accepted Realtime, overlapping-read prevention and online retries after the cached driver becomes online.

## Remaining device checks

Actual concurrent clicks from two devices, notification display on locked iPhone/Android, background GPS after OS suspension and burst-load latency have not been measured. A browser cannot guarantee background GPS or handset notification delivery; stale GPS intentionally removes the driver from new dispatch eligibility. Retry after provider acknowledgement can redeliver a notification; stable notification tags reduce visible duplicates, without an exactly-once claim.
