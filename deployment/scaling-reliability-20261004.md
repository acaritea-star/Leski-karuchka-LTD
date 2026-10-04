# Reliability and bounded load checks — 2026-10-04

This release reduces redundant reads and hardens request recovery. It preserves
the existing design, buttons, GPS write frequency and server dispatch rules.
No new dependencies or paid services were added. All checks below made zero
Google API requests.

## Frontend behavior

- Live customer request and driver-position reads reconcile every 30–36 seconds
  with a healthy Realtime connection, or every 5–6 seconds while disconnected.
  Initial reconciliation closes subscription gaps. Random delay spreads clients.
- Reads have a 10-second deadline, cannot overlap, back off after failures, pause
  in hidden pages and resume on visibility/network recovery. Stopped or timed-out
  reads cannot overwrite current state when an old response eventually arrives.
- Driver active-request queries reconcile every 30 seconds while connected and
  every 8 seconds after disconnect. Pending-request queries use 15/8 seconds and
  stop while the driver has an active ride. The request list is bounded to 50.
- Company request subscriptions filter by company ID; the driver's own request
  subscription filters by driver ID. Company event bursts reuse pending reads.
- The driver home badge uses the existing ten-row request result and retains
  its `9+` display, removing a separate exact count query.
- A synchronous guard prevents two rapid accept clicks from sending two RPCs
  before React renders the pending state. Accept and ride transitions have a
  15-second deadline; the database remains authoritative.
- Monotonic snapshot merging prevents a delayed read from reversing a newer
  Realtime status or reopening a finished ride. Ended customer rides stop live
  subscriptions and polling.

## Database change

Migration `20261004110928_scale_reconciliation_and_rls.sql` was applied to project
`rzjyvxmfqnnxglmgnvma` through the management API and mirrored locally using its
server-generated version.

The migration caches caller-only identity checks in 29 existing RLS policies.
`private.current_driver_id()` is stable, has an empty search path, is executable
only by authenticated callers and returns only the active caller's driver ID.
The policy roles and ownership rules are preserved. Four indexes cover user
notifications, completed driver requests, company locations and vehicle type.

Nearby-driver eligibility and lookup functions are unchanged: a proposed rewrite
was slower in the temporary 500-driver workload and was discarded before deploy.
The earlier Routes request budget remains in place; no Edge Function was
redeployed in this release.

## Completed checks and their limits

| Check | Result | Scope |
| --- | --- | --- |
| `npm run check` | Passed: 255 tests in 40 files, lint, TypeScript, production build | Includes delayed replies, double accept, deadlines, disconnection and snapshot races |
| 100 simulated tracking readers | Passed; at most six reads per reader over 120 seconds; no reads after stop | Fake timers and mocked transport, not 100 live sockets |
| Eight SQL workloads | 120 requests and 800 GPS upserts passed | Management connector serialized the transactions; observed database concurrency was one |
| Nearby lookup with 500 temporary drivers | Passed | Five measured reads; not a long-running concurrent dispatch test |
| SQL security and lifecycle regression | Passed after deployed migration | Actual RLS claims, cross-company isolation, acceptance retries, cancellation accounting and protected price |
| Public HTTP reads | 40/40 HTTP 200 with eight calls in flight, zero writes | Unauthenticated Data API reads, not authenticated dispatch capacity |
| Authenticated HTTP contention | Prepared; not executed | Fixture creation was rejected by automatic approval review |

The public HTTP test measured end-to-end p95 **7,755.02 ms**, maximum **7,878.63 ms**
from the execution environment. These values include network, TLS and gateways;
they are not database execution times. The cause of the latency was not isolated.
This result warrants further measurement from real customer/driver devices.

SQL fixtures were rolled back. The follow-up database check found no retained
scale-test users or companies and reported zero database deadlocks. Performance
advisor `auth_rls_initplan` findings fell from 24 to 13 and unindexed foreign-key
findings from 18 to 16. Security-advisor finding categories/counts did not increase;
existing findings remain and this is not a clean security certification.

The authenticated runner would exercise four synthetic accounts in an isolated
company, two ride lifecycles and at most eight in-flight HTTP calls. Its seed would
commit production records, so it was not run after the approval rejection. No
fixture accounts were created. Use a staging database or explicit fixture approval
before running it, and arrange owner cleanup even when assertions fail.

## Reproducing the bounded checks

```sh
npm run check
node scripts/scale-smoke.mjs --sql
node scripts/scale-smoke.mjs --lookup-sql
# Requires psql and LESKI_TEST_DATABASE_URL pointing at a test database:
node scripts/scale-smoke.mjs --run
# Private config contains project and publishable_key; read-only:
python3 scripts/http-read-smoke.py /path/to/private-read-config.json
# Staging/explicitly approved fixtures only; not executed in this release:
python3 scripts/http-concurrency-smoke.py /path/to/private-fixture-manifest.json
```

The SQL generator and tests use BEGIN/ROLLBACK. They never call Google; queued
pg_net work is not sent before commit. Do not commit fixture passwords or tokens.

## Capacity and release

These checks improve reliability but do not establish a production user limit.
An actual authenticated contention run, live browser Realtime sessions and a
longer device pilot remain necessary before advertising capacity for hundreds or
thousands of simultaneous users. If the project remains on Supabase Free, the
published Realtime allowance is 200 concurrent connections and 100 messages per
second; verify the project's actual plan and usage before a larger rollout.
Postgres Changes also authorizes events for each subscriber, so message fan-out
must be measured separately from the number of GPS writes.

Database migration is live. Frontend delivery requires **Pull → Publish in Readdy**
after the GitHub update; a GitHub commit alone does not verify the hosted release.

Primary references:

- [Supabase Realtime limits](https://supabase.com/docs/guides/realtime/limits)
- [Supabase Postgres Changes scalability](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Supabase RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations)
- [pg_net transaction behavior](https://supabase.com/docs/guides/database/extensions/pg_net)
