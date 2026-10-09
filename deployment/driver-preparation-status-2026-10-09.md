# Driver preparation release

Verified application source: e11339c23c4b1bda9066e84e1358163792a13edf.
Supabase migration: 20261009193230_driver_preparation_and_policy_receipts.
Driver conditions: 2026-10-09-driver.1. Training: 2026-10-09.1.
Source SHA-256: 5f4e2d7898ff8ca7197dc7929453db805b77cd88b501f8e8fc6a62f1f46f6d53.

## Where to use it

Driver → Profile → Preparation for drivers. Five topics, three questions, one
explicit acceptance button. Conditions are readable/downloadable before and
after acceptance. The server writes general acceptance, driver terms and training
completion in a single idempotent transaction.

Admin → Drivers → Details. The verification report displays missing preparation
or the accepted conditions/training versions and time. An administrator cannot
accept for the driver. A direct verification update is rejected until the
driver's receipt and the existing document/vehicle requirements are satisfied.

Driver applicants can read conditions in the explicit application journey.
No new driver-terms links in customer menus or the shared footer.

Already verified drivers retain their status; new verification requires the
preparation. Future contractual changes need applicable notices and legal review.

## Evidence

* 402 unit/component tests; strict TypeScript, ESLint and production build passed.
* GitHub Check run 37980601060 passed, including Deno checks, exact legal-source
  digest verification and six browser scenarios on Chromium/WebKit.
* GitHub Database regression run 37980601042 passed in disposable Supabase,
  including the full existing suite plus the end-to-end document/vehicle/
  preparation/verification gate and personal acceptance/RLS/atomicity tests.
* Browser test simulated a committed acceptance with its response lost; the
  authoritative read recovered the same receipt without a duplicate POST.
* SQL tests rejected stale versions/hashes, wrong answers, foreign accounts,
  admin acceptance on behalf of drivers, anonymous access, deactivated drivers
  and direct receipt writes. Retrying returns the same record and time.
* Production read-only checks confirmed the registered hash and versions,
  five topics/three questions, verification gate, RLS enabled, anonymous execute
  denied, client writes denied and public wrappers using SECURITY INVOKER.
* Security advisors introduced no new warnings/errors. Private version-table RLS
  with no policies is deliberate: only authorised private functions read it.
  New indexes being unused before real receipts exist is informational.
* The initial staging DB run caught a function-statement delimiter error. It was
  fixed before production; the subsequent complete DB run passed.

No tests called Google APIs. No real user was enrolled, accepted on behalf of,
re-verified or used as a fixture.

## Publishing and legal limits

GitHub source and Supabase configuration are separate from the Readdy-hosted
frontend. Pull/Publish the new main build in Readdy if it is not yet visible;
/release.json should show 2026.10.09-driver-preparation.1.

The release does not certify the operator's missing registration/address details,
the intermediary classification, all mandatory transport checks or paid legal
readiness. Liability limits preserve intentional/grossly negligent and other
non-excludable statutory liability. See driver-preparation-legal-review.md.

Recovery: restore-driver-preparation.sql restores the exact previous report and
basic-data export, preserving receipts and all user data.
