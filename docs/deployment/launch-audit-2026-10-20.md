# Launch audit — 20 October 2026

Scope: customer booking and tracking, driver dispatch and payment checkout, company
isolation and accounting, authentication/MFA, notifications/PWA, public/mobile UI,
operational jobs and deployment consistency. This is an engineering audit, not a
claim that every possible defect has been excluded.

## Reproduced defects and changes

- Ordinary logout used Supabase's default global scope, terminating refresh sessions
  on other devices. Explicit local scope preserves independent device sessions.
- A delayed logout response could clear a newer account, including a new login to
  the same account. Identity revisions now reject stale completion; the logout UI
  cannot navigate after its account screen unmounts.
- Staff OAuth attempted legal acceptance at aal1 before reaching the MFA screen.
  Production logs included four 403 responses on this RPC. Only the specific
  server MFA_REQUIRED error now defers acceptance and continues to MFA. Other
  authorization failures remain errors. The legal notice still requires a server
  record; no role, MFA, or acceptance rule has been weakened.
- Failure to download the optional welcome module could reach the root error
  boundary and replace the booking screen. A local error boundary now isolates it;
  booking and 112 remain usable. Account-level at-most-once claims are unchanged.
- The invitation RLS policy recalculated the authenticated identity per row.
  Constant identity/MFA checks now use scalar subqueries; company-dependent
  predicates and parent/child permissions are unchanged.
- Application roles had write privileges on the PostGIS coordinate-reference table.
  A statement trigger rejects their INSERT/UPDATE/DELETE/TRUNCATE operations while
  preserving reads and trusted database/extension maintenance. The hosted table is
  owned by supabase_admin, so postgres cannot enable its RLS or revoke those owner
  grants. This mitigation does not hide the advisor finding or move the extension.
  Supabase Support should coordinate a later relocation with all geographic
  function/type dependencies. Never DROP EXTENSION postgis CASCADE on this app.

## Verified starting production state

- Public release: 2026.10.20-customer-welcome.1 (rechecked during audit).
- Staff MFA enabled. Ride-payment-required flag was still false despite the
  published checkout UI. Activation script: deployment/enable-ride-checkout.sql.
- Seven companies: three active; all seven lack recorded legal verification.
  The Leski parent and three city divisions are inactive/incomplete; Levski has
  no configured tariff. Do not replace missing legal identifiers with invented data.
- Four drivers, none online at the sampled instant. One in-progress ride is about
  94 hours old. Review it with its driver/company; do not fabricate a payment or
  close it automatically. No unfinished ride has a missing estimated fare.
- No active request/driver company mismatch and no push-outbox/inbox recipient
  mismatch in the read-only consistency queries.
- Scheduled dispatch, expiry/maintenance, metric pruning, observation pruning and
  document notifications all had successful runs in the sampled last 24 hours.
- Traffic was too low to infer production p95 booking latency or capacity. There
  were no new rides in that window; a successful synthetic test is not a live trip.

## Remaining launch prerequisites

1. Actual operator name, EIK and registered address are missing in
   src/config/legalOperator.json. Terms remain draft and check:legal-release fails.
   Complete the real data and recorded reviews; do not turn flags green without
   the underlying evidence.
2. Confirm company permits, tariff/fiscal flow and company readiness. Existing
   active companies have no recorded legal_verified_at; this audit does not certify
   their status. Leski divisions still need real setup and activation.
3. Perform a supervised real customer/driver trip: quote, selection, acceptance,
   arrival, GPS foreground/background/resume, cash/card confirmation and company
   report. Physical iPhone/Android push delivery and OS permissions require devices.
   Browser emulation does not prove lock-screen push or continuous background GPS.
4. Publish the tested package through Readdy and verify its release/entry assets.
5. Track the extension-owner advisor finding, leaked-password-protection setting,
   backup/restore drill and external Maps/Auth provider configuration. OAuth is the
   current app login; the leaked-password advisor is not proof of a password leak.

## Validation

Baseline: 680 unit tests, 81 mobile Chromium browser scenarios, typecheck/lint/build.
New regressions reproduce stale logout and global scope before the fix, cover MFA
handoff and optional-chunk failure, and exercise PostGIS write denial and geography
reads on disposable native Supabase. Final CI and activation evidence are recorded
in release metadata and the final audit update.

No dependencies, realtime channels, polling loops, or automatic financial retries
were added. Existing tests cover tenant boundaries, two drivers competing for one
request, idempotent money posting, lost responses, partial/unpaid fares, expense
proofs, GPS freshness, notification ownership, mobile layout and accessible actions.

## Dependency review

`tailwindcss-animate` is only loaded by tailwind.config.ts during CSS compilation;
it is now correctly a devDependency. Lockfile versions, resolved URLs and integrity
hashes are unchanged. `npm audit --omit=dev` reports zero vulnerabilities (73
production dependencies). CI now gates high/critical production dependency alerts.
This classification does not patch or hide the build-tool findings: the full audit
still reports five high and two moderate affected dependency entries, arising from
braces GHSA-vfj7-8cjw-p6xm and postcss-selector-parser GHSA-rj75-hqrm-r3gf. These
packages process repository-owned patterns/selectors at build time; they are not
imported in the browser or Edge Functions. Braces has no patched version in the
advisory; selector-parser is patched in 7.1.6, outside Tailwind 3's dependency range.
Do not expose this build toolchain to user-supplied CSS/globs. Track the upstream
update; migrating to Tailwind 4 needs a separate visual regression review.

## Confirmed validation and database deployment

- Source cfd2bd6308188d0fa19da6b2a86ba6a3130aa558: 686 unit tests across 104 files,
  165 Chromium/WebKit browser scenarios passed, one skipped; typecheck, lint,
  production build, legal-source integrity and Edge Function checks passed.
- Check: https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/39404886473
- Native Supabase: https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/39404886657
  Company/receipt/file isolation, real Auth/MFA, conflicting driver acceptance,
  duplicate payment retries, welcome concurrency and geographic guards passed.
- Production migration 20261020151835_launch_api_hardening was applied successfully.
  Read-only verification plus rolled-back, zero-row application-role writes confirmed
  anon/authenticated denial, enabled SECURITY INVOKER trigger and working distances.
  The migration SQL matches the native-tested source; only its applied timestamp changed.

## Production checkout activation

The live JavaScript graph was inspected before enabling the gate: release
2026.10.20-customer-welcome.1, entry /assets/index-BTuBb91b.js,
/assets/RideCheckout-D4aT7NwK.js contains complete_ride_payment and both cash/card
confirmation actions. All 116 referenced JavaScript assets loaded successfully.
`deployment/enable-ride-checkout.sql` enabled ride_payment_required at
2026-10-20T15:20:47.045745Z. A subsequent read confirmed both staff MFA and payment
checks enabled. No ride, receipt, balance or payment was created or rewritten.
Legitimate partial/unpaid-with-reason paths remain available and tested.

After deployment the invitation auth_rls_initplan advisor finding is gone.
The spatial_ref_sys RLS/extension-owner finding remains visible despite the tested
write guard; do not describe the security advisor as fully clean.

The final source package is 5247c5fcfa86daffedd1b81ac5d824913c89c43b; it only adds
build-dependency classification, its CI audit gate, the applied migration timestamp,
and documentation/whitespace to the previously green application code. Both final
runs completed successfully: 686 unit tests, 165 browser scenarios, one documented
WebKit capability skip, zero runtime dependency alerts, and native Supabase tests.
All 135 fresh build files were hash-checked against the packaged GitHub tree;
retained historical assets were preserved. Final runs:
- https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/39447522847
- https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/39447523038

## Package size and unresolved advisor follow-up

Current initial JavaScript graph: 31 files, 659,716 raw / 210,063 gzip bytes.
Booking including initial: 43 files, 756,736 raw / 244,418 gzip bytes. Relative to
the measured baseline, initial gzip increased by 107 bytes and booking by 105
bytes. No Maps download or network latency is included in this source-size metric.
The fixes add no runtime dependency, channel, interval or background polling.

- [Hosted extension RLS finding](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)
  is mitigated for writes, with support-assisted relocation still pending.
- [Extensions in public](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
  remains for PostGIS/pg_net; do not drop extensions used by live GPS/dispatch.
- The password-protection configuration warning remains; current UI uses OAuth.
- Nine missing foreign-key indexes are informational at current scale. Do not add
  write overhead or remove currently unused indexes without query evidence;
  production traffic did not establish a bottleneck in those relationships.

## Historical Edge error requiring follow-up

A function_edge_logs HTTP 500 at 2026-10-19T10:52:00.657Z belongs to
POST /functions/v1/road-geometry (214 ms, request
01a153ca-2a3b-7230-8d6f-17207f398381). The initially empty path was a log-field
mismatch: function logs use request.pathname, while API logs use request.path.
The deployed function and both shared modules match the repository byte for byte.
No function runtime exception was available in that minute's log sources, so the
cause is unresolved. The client tolerates unavailable geometry and bounds retries;
this does not prove recovery of authenticated road lookups. The later 24-hour
sample had no Edge invocations, so absence of repeated failures is not reliability
evidence. Include authenticated road loading in the supervised real trip.
A current, non-mutating endpoint probe returned OPTIONS 204 and anonymous POST
401 (Authentication required). This confirms startup and anonymous rejection,
not success of an authenticated upstream road-data request.

The single browser skip is the service-worker test on WebKit: Playwright exposes
background service workers through its Chromium API. Chromium executes that test;
physical iOS PWA push remains a separate device check.

## Primary references

- https://supabase.com/docs/guides/auth/signout — global/local session scopes.
- https://supabase.com/docs/guides/database/postgres/row-level-security — constant
  auth checks via SELECT; correlated company predicates remain per row.
- https://supabase.com/docs/guides/database/extensions/postgis#troubleshooting —
  hosted ownership and support-assisted relocation of public PostGIS.
- https://www.postgresql.org/docs/current/sql-createtrigger.html — TRIGGER privilege,
  statement triggers and INSERT/UPDATE/DELETE/TRUNCATE coverage.

- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm — build-only braces depth exhaustion.
- https://github.com/advisories/GHSA-rj75-hqrm-r3gf — selector-parser reachability and patch.
