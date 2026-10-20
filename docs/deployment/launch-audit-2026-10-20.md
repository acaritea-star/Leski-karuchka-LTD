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
