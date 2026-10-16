# Customer emergency access and staff MFA

## Emergency action

Customer booking, active-trip tracking, orders, profile and settings have a compact red 112 control. It opens an accessible dialog and a `tel:112` link; it does not call automatically. It remains available during customer profile loading/failure and uses no GPS, map API or backend call and creates no incident record or automatic company notification. The dialog explains that this application does not send trip/location data to 112. On devices without a dialer, use a phone. Automated tests inspect the link without activating an emergency call.

Official source: [EU emergency number 112](https://digital-strategy.ec.europa.eu/en/policies/112).

## Role model and authentication

The existing application roles are CUSTOMER, DRIVER, COMPANY_ADMIN and SUPER_ADMIN. Company administrators represent the firm's administrative accounts; there is no separate ADMIN enum. Customers retain their existing first-factor login. All three staff roles require TOTP setup or verification in the new frontend before any staff data, GPS, offer or notification providers mount. MFA is loaded on demand, with no new package, SMS service, polling or realtime channel.

Enrollment is explicit. The QR and manual secret exist only in component memory; they are not written to local/session storage or telemetry. Leading-zero codes are preserved. Factors and challenges use Supabase Auth, not a custom code generator or database secret. Switching accounts prevents a pending setup from continuing in the wrong account. An uncertain enrollment can be retried after removing only this application's incomplete, unverified factors. Verified factors are never automatically replaced.

Staff can add a second authenticator from driver Profile or administrator Settings. The UI requires one verified authenticator to remain. Removing a verified factor requires an already verified Supabase session; a first-factor-only login cannot remove it. After factor changes the token is refreshed. Server MFA errors return the current session to the challenge screen and clear mounted private data/GPS. Delayed errors for another token do not lock the new session.

## Server enforcement

The migration adds a private deployment switch, initially **off** for a coordinated frontend cutover. When enabled:

- Staff authorization uses the current role in `profiles`, signed JWT `aal2`, an existing same-user `auth.sessions` row at `aal2`, and that session's currently verified MFA factor. User-editable metadata is not used. A stale `aal2` JWT after factor removal/session downgrade is rejected.
- A PostgREST pre-request hook covers direct Data API requests, including SECURITY DEFINER RPCs. Its sole low-assurance exception is GET/HEAD of profiles for own-profile bootstrap; restrictive RLS permits only the caller's own row and denies writes.
- Restrictive policies cover the existing RLS application tables, `storage.objects` and `realtime.messages`. They preserve all existing ownership/company rules. Role predicates also require the second factor. A regression checks that future RLS application tables do not omit the MFA restriction.
- Edge Functions first validate the bearer using GoTrue and then use a service-only check of the current database role/session/factor. Browser roles cannot call that API or alter the deployment switch. Worker/service credentials remain separate from interactive staff logins.

Short-lived Storage signed URLs already issued before revocation remain valid until their existing expiry. Realtime channel authorization may be cached until reauthorization; the notification Broadcast payload remains limited to event ID/type/priority, and content retrieval always goes through current RLS/Data API enforcement. This release does not claim instant revocation of previously downloaded data.

References: [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa), [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), [Data API pre-request limitations](https://supabase.com/docs/guides/api/securing-your-api), [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control). Current docs and changelog were reviewed; the pinned SDK supports the required methods.

## Verification and rollout

Tests include enrollment, wrong/leading-zero code, duplicate submit, failed factor lookup, backup setup without deleting the verified factor, server-triggered reauthentication, customer first-factor access and visible emergency controls on narrow screens. SQL tests cover all staff roles, raw reads, own-profile bootstrap, forged user metadata, session downgrade, unverified factor, company isolation and role promotion.

`scripts/test-staff-mfa-http.mjs` runs only against disposable localhost Supabase. It exercises actual Auth enrollment/TOTP verification and signed JWT access through PostgREST, including rejection of the old first-factor token and rejection of a stale verified token after factor removal. Synthetic accounts are removed and enforcement is restored to off. No real accounts or factors are enrolled by deployment tests.

1. Verify candidate Check and Database regression workflows.
2. Apply the migration with enforcement off and redeploy all Edge Functions using `_shared/auth.ts`.
3. Merge/package the tested frontend. Publish via Readdy and verify its release marker.
4. Enable `deployment/staff-mfa.activate.sql`. Existing staff sessions must verify/setup MFA; customers retain their current access. Do not activate while an older frontend without the setup screen remains the published release.
5. Each staff member enrolls their own authenticator and preferably a backup. The deployment cannot scan a personal QR or confirm that person's code on their behalf.

For a lost sole authenticator, the project owner must verify the person's identity and perform a controlled MFA reset through Supabase Auth, recording the action. There is no email-only or client-side bypass. Factor reset forces setup again. Never expose the service key or a reset API to the browser.

Emergency rollback: `deployment/staff-mfa.rollback.sql` disables server enforcement without deleting factors, sessions, application records or tenant rules; restore the matching frontend as required. The emergency 112 control has no database dependency.

## Deployment evidence

- Candidate `52f904c78e48c3ee88ee1bd3cdae5da2e9066f9d`: [Check](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38867742781) and [Database regression](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38867742791) passed. This includes 582 unit/component tests, 106 browser scenarios and actual Auth/TOTP for each staff role. The final package additionally checks emergency access during profile failure and the Edge assurance predicate.
- Production migration applied as `20261016073419_customer_safety_staff_mfa`; the CLI-created candidate was renamed to match the actual history version without changing its SQL. SHA-256: `a193f214bca82c3c8701c2f7c55417d3414f3fc6f1b3a16fbedbd4ce79a8fd26`.
- Readback: hook installed, 36 restrictive MFA policies, browser access to the deployment switch and service-only Edge proof API denied. `staff_mfa_enforced` is **false** pending frontend publication/cutover. No real factors were created or existing sessions removed.
- Updated and read back the exact shared Auth source: google-geocode 9, google-routes 14, generate-vapid-keys 12, send-push-notification 11, expire-stale-requests 9, road-geometry 5, partner-invitation-email 2. Existing entrypoints, dependencies and JWT settings were preserved.
- Advisor review: the new private deployment table intentionally has RLS without browser policies or browser grants ([advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)). Existing PostGIS/extension/password advisories remain separate from this feature; the [PostGIS finding](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public) is not claimed fixed.
- The first integration attempt lacked the Auth SDK in the database job. A later attempt passed the real MFA scenarios but failed cleanup because company bootstrap creates vehicle categories. CI now installs the pinned client, explicitly enables only TOTP in the disposable project, and removes its synthetic categories before its synthetic firm. No production test accounts, documents, calls or notifications were created.

- Forward hook fix `20261016074354_staff_mfa_public_request_hook` preserves anonymous public reads through a public SECURITY INVOKER wrapper; it calls the private guard only for authenticated users. Production anonymous Data API probing returned HTTP 200 after the correction. No USAGE privilege on the private schema was granted to anonymous clients. The earlier direct private-hook registration briefly refused anonymous reads and was corrected before merging. The final regression explicitly tests anonymous reads with enforcement both on and off.
