# Unified company driver onboarding

Company administrators obtain a company-specific joining link in **Шофьори → Добави шофьор**. The Google/Facebook return preserves that company, accepts only a UUID and never chooses an arbitrary return URL. This is a joining link with human approval, not a token that grants employment or driver access.

The applicant saves basic contact details, personally accepts the current driver conditions and completes the existing training. Only then does the screen show document uploads. Own-car applicants provide make, model, registration, insurance/inspection dates, licence, insurance and the registration certificate. The certificate is recorded without an invented expiry. Applicants without a car upload their licence; the company selects a free company vehicle and uploads its insurance during the same review.

The applicant explicitly submits the full package. Administrators first open its private files, attest to the identity/vehicle/document checks and applicable taxi qualifications and permissions, then use **Одобри и верифицирай наведнъж**. The server checks the current personal receipt, latest actual file objects, dates, active company permit/category/vehicle, free vehicle assignment and unchanged package revision. Profile conversion, documents, personal receipt transfer, assignment, verification and audit commit together. A verified driver stays offline until personally choosing online. This software review is not a state taxi licence or a substitute for the firm's legal document checks.

Returning a package requires a correction note. The applicant reopens the same package, retains saved training/documents, makes corrections and resubmits. Lost POST responses are checked against authoritative state; uploads reuse immutable IDs and never overwrite existing files. A stale administrator review cannot approve a changed revision. Existing published clients continue their original guarded enrollment through the legacy RPC; the new client explicitly starts the unified intake RPC. Existing verified drivers retain their previous preparation policy.

## Deployment and verification

- Runtime source: `4ad53fa2a4293d049eea6ccece0da901be241cf1`.
- [Check](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38084650905): lint, TypeScript, **420 unit/component tests**, build, legal-source verification, Deno and **14 Chromium/WebKit browser scenarios**, all successful.
- [Database regression](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38084650908): full disposable Supabase suites, actual applicant/admin/foreign-admin/anonymous roles, own/company-car paths, correction, stale revision, atomic failure, idempotency and existing financial concurrency checks, all successful. Synthetic Storage metadata tests do not claim real production file uploads.
- Production migration: `20261010204407_unified_driver_onboarding`, applied **2026-10-10 20:44 UTC**. Filename matches Supabase's recorded version; tested SQL content is preserved.
- Production readback: both new tables have RLS, no anonymous reads or direct client writes; all eight public intake RPCs are invoker wrappers, authenticated-only; the bucket stays private, 5 MB per file and JPG/PNG/WebP/PDF.
- Security advisor findings are unchanged from the pre-migration snapshot. Existing advisor warnings remain outside this change.
- No Google API calls or new dependencies are introduced. Test browsers block traffic to real backends and paid providers.

Source publication to GitHub does not establish that Readdy has published the frontend on leskikaruchka.com. Pull the final main version and publish there. Real Google/Facebook sessions, actual mobile device uploads and visual document checks still require a user acceptance pass.

## Recovery and boundaries

`driver-onboarding-before.sql` captures prior mutable function definitions. `restore-unified-onboarding.sql` disables the new public entry points, restores the legacy application/export functions and disables new candidate uploads without deleting submissions, profiles, vehicles, receipts or files. The expanded file guard/read policy must remain for documents already approved from the three-segment intake path. Deploy the previous frontend with that recovery script. This is a prepared recovery path, not a production restore drill.

Uploads are capped at 5 MB and normal intake allows up to 12 file objects for replacements; the policy count is not a strict concurrency quota or a complete abuse-prevention system. Registration numbers already present in the company currently require resolving the existing vehicle before own-car activation; an assigned vehicle cannot be taken from another driver. Administrator options use the existing API row limits. Company transfers and official registry validation are separate workflows.
