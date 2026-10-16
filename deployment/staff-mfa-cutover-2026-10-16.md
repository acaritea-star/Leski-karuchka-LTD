# Staff MFA enforcement activated

Production project `rzjyvxmfqnnxglmgnvma`: the existing deployment switch was
enabled at **2026-10-16 12:19:40.947757 UTC** (15:19 Europe/Sofia).

The operator confirmed enabling TOTP enrollment and verification in Supabase.
Before cutover, the live website served `2026.10.16-booking-performance.1`, with
`staffMfaVersion: 1` and roles SUPER_ADMIN, COMPANY_ADMIN and DRIVER. The actual
module entry and its StaffMfa chunk returned JavaScript HTTP 200 and contained
both enrollment and challenge/verification. The browser's earlier analytics
script was excluded when locating the application module.

Activation used the existing `private.app_security` singleton, changing only
`staff_mfa_enforced` and `changed_at`. Existing factors, sessions, application
records, prices and tenant rules were retained. Customers remain exempt from
mandatory MFA. Browser roles cannot change the switch or call the service-only
Edge assurance API.

Production verification after activation:

- Scoped, rollback-only SQL checks exercised the application predicate,
  PostgREST pre-request hook and service-only Edge assurance predicate. All seven
  active staff profiles were denied at AAL1; three sampled customer profiles
  remained allowed at AAL1. The existing verified staff session passed the live
  session/factor proof at AAL2. No application records were written by the checks.
- Anonymous public Data API read returned HTTP 200 after activation.
- Earlier full CI on the identical runtime source passed actual signed Auth
  TOTP scenarios for all staff roles, wrong codes, new/old AAL1 tokens, factor
  removal, customer access, own-profile bootstrap, company isolation, and
  anonymous reads with enforcement both on and off:
  [Check](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38895753557),
  [Database regression](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38895753576).

This commit updates only the release metadata and this receipt; runtime JS/CSS
is unchanged. The new static marker is `2026.10.16-staff-mfa-enforced.1`; it will
appear on the website when next published through Readdy. Backend enforcement
is already active and does not wait for that metadata publication.

MFA remains attached to the valid persisted session. Opening/reloading the app
or toggling a driver online/offline does not deliberately request another code.
A fresh first-factor login needs MFA again. Browser storage deletion, session
revocation/expiry and factor removal can also require reauthentication.

Rollback remains `deployment/staff-mfa.rollback.sql`, which disables enforcement
without deleting factors or application data. No real accounts, factors, rides,
messages or paid Google requests were created by this cutover.
