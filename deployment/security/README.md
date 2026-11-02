# Security staging — 29 October 2026

Scope: an isolated branch and disposable CI services. No deployment to Readdy,
the hosted Supabase project, Stripe, or main is part of this change.

## Applied in the disposable test database

1. Revoke redundant anonymous SELECT on twelve sensitive tables. Keep existing
   authenticated/service grants and RLS unchanged; test public news explicitly.
2. Remove application-role MAINTAIN on postgres-owned application tables.
   New postgres-owned public tables/sequences require explicit client grants;
   new functions no longer inherit PUBLIC execution. Existing RPCs are intact.
3. Cache landing aggregates in one private RLS table for 60 seconds, with a
   nonblocking single refresher across workers. The public GET handler adds a
   warm-worker cache, single flight, 300 requests/minute per-worker ceiling,
   five-second failure cooldown, method restrictions and fixed error messages.
   This reduces database work; it is not a global traffic firewall.
4. Add a service-only VAPID reader. Before cutover it reads the existing pair;
   afterwards it reads Vault. Both Edge consumers use that reader. There is no
   automatic key generation on errors. Synthetic tests cover exact-pair
   preservation, cutover/repeat, rollback and partial-configuration rejection.
5. In CI only, the local managed owner applies the net ACL script, tests enqueue
   inside a rolled-back transaction, then reapplies it before the application
   SQL regression. No notification or arbitrary outbound HTTP is sent by this
   security test. The postgres-owned dispatcher retains its needed privileges.
6. The maintenance endpoint compares fixed-size token digests with Node's
   timingSafeEqual. Normal authenticated administrator authorization remains.
7. Browser tests run with nosniff, a referrer policy and a CSP in report-only
   mode. There is no claim that this CSP is enforcing protection or that Readdy
   will apply Vite development-server headers.

## Test environment and limits

`npm run check` covers lint, unit tests, TypeScript and a build with synthetic
localhost configuration. Playwright checks mobile Chromium and WebKit using
mocked service boundaries. `npm run test:database` starts from the real schema
checkpoint plus migrations in disposable Supabase; it exercises SQL ownership,
RLS, ride lifecycle, money integrity, concurrency, Auth/MFA and the new security
checks. The temporary-schema test-helper grants in run.sql do not re-open
public/private application function defaults.

The SQL suites are rollback-only. Existing concurrent fixtures suppress HTTP
dispatch before committing synthetic records. New VAPID tests use synthetic
strings, not production keys. No live payment is made. Real Google/Facebook
redirects, native installed-PWA push delivery, real Stripe bank challenges and
Readdy hosting cannot be certified by these fixtures.

## Settings requiring a separate hosted staging project/operator

- Leaked-password protection is a hosted Auth setting available on Pro and
  above; production has not been changed. The CI job starts a second disposable
  GoTrue container with GOTRUE_PASSWORD_HIBP_ENABLED and FAIL_CLOSED enabled.
  It calls the actual HIBP integration with synthetic passwords and verifies
  leaked signup/change rejection, strong signup/login/change, legacy sign-in
  and unchanged provider settings. A hosted rollout still needs plan support
  and real Google/Facebook redirect checks. Preserve the four existing password
  customers; do not disable their provider.
- Hosted net objects are owned by supabase_admin, and the current production
  postgres role cannot revoke their privileges. The owner script fails before
  modifying anything when permission is missing. Supabase must provide the
  supported owner action; successful local-owner execution does not grant that
  ability in production. Recheck after extension upgrades.
- Repository visibility and main-branch protection are account settings. No
  changes are made here; coordinate with Readdy's access/publishing workflow.
- The inspected live HTTP response on 29 October had none of CSP, nosniff,
  referrer-policy, permissions-policy, HSTS or X-Frame-Options among the returned
  headers. Configure/observe staging hosting first. The supplied CSP still
  needs real-provider and PWA observation before enforcing it.

## Deployment order, only after separate production authorization

1. Record existing grants/default grants, current code versions and hosting/Auth
   settings. Keep keys in the existing secret stores; never export them into a
   report or repository. New SQL files were created by Supabase CLI 2.120.0.
2. Apply each migration separately and check public pages, authenticated flows
   and permission assertions. The twelve-table change has a precise rollback
   in anon-select-rollback.sql. Restore other ACL/default changes from the
   captured catalog rather than granting blanket access.
3. Deploy landing-stats after its cache RPC migration.
4. Deploy BOTH generate-vapid-keys and deliver-push after the VAPID reader RPC.
   Validate an isolated subscription with the unchanged public key. Only then
   run vapid-cutover.sql inside BEGIN/COMMIT to move the old pair within the DB
   into Vault and clear the plaintext private-key column. This script returns
   no secrets and refuses a different stored pair.
5. For rollback, run vapid-rollback.sql in a transaction BEFORE restoring either
   old Edge Function; it restores the same private key without deleting Vault.
6. Apply net owner changes independently with the provider. Review actual
   dispatcher and push behavior. Do not merge a local-only admin credential or
   substitute application tests for a hosted permission check.
7. Auth and hosting changes remain independent, reversible releases. Do not
   enforce the draft CSP or disable password login as part of this branch.

References:
- https://supabase.com/docs/guides/api/securing-your-api
- https://supabase.com/docs/guides/database/vault
- https://supabase.com/docs/guides/auth/password-security
- https://supabase.com/docs/guides/database/extensions/pg_net
