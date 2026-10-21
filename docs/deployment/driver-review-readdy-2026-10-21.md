# Driver verification and Readdy build recovery — 2026-10-21

The GitHub source still used CommonJS `require` inside the Tailwind TS/ESM config and kept `tailwindcss-animate` in devDependencies. Readdy's local repair was replaced by each GitHub pull. Animation utilities are actually used by the menu, modals and request cards. Keep the pinned plugin, use an ESM import, and retain it during production-only dependency installation. `npm run check:build-config` loads the actual config and compiles the affected animation utilities; the normal `npm run check` includes this check.

## Review flow

- Driver list → **Кандидатури за одобрение** opens submitted applications directly, without the invitation form.
- Review documents → select/check vehicle → confirm review → one server-side verification operation. The server continues to own role changes, firm isolation, revision checks, immutable private file validation, policy acceptance, vehicle allocation and audit records.
- The previous application form was keyed by every onboarding revision. A company insurance upload increments that revision; this remounted the form and erased the selected vehicle, already opened files and confirmation. The form now remains mounted for the same application. A file's reviewed status is keyed by its immutable ID, private path and expiry. A changed/new file must be opened again. Final confirmation is always tied to the current revision and is cleared after a failed/ambiguous submission or a vehicle/category change.
- Company insurance upload starts after vehicle selection; its expiry defaults to the selected vehicle's recorded insurance date. Uploading/refreshing disables approval. A failed preview or blocked popup never marks a file reviewed.
- Missing documents, unreviewed documents, training, category/vehicle selection, expired permits/vehicle dates and mismatched insurance dates are shown next to the disabled approval button. Refresh actions preserve vehicle/note but reload authoritative requirements.
- Existing drivers open the complete checklist through **Верифицирай** or **Детайли**. Document approval and final driver verification are in the same dialog. Document updates match driver, company, previous status and previous expiry; unsaved date edits block verification. Conflicting edits require another review. Confirmed verification is reflected in the open dialog; lost write responses are reconciled once, without automatically toggling again.
- Review dialogs use normal scroll flow. Controls must remain clickable on mobile; the checklist does not float over document or refresh buttons.

## Session and invitation incident

A screenshot showed `JWT issued at future`. The profile loader previously treated this specific temporary rejection as a permanent authentication failure. It now retries the read at most twice (1s and 2s delays), retaining normal server JWT validation. A persistent failure shows a Bulgarian retry message and grants no profile access. Other 401/403 permission failures still fail closed. This mitigates short server timing differences; it cannot repair sustained provider clock skew.

The invitation incident was a recipient-email typo. The personal invitation check correctly denied a different signed-in address. The denied screen explains exact email matching and asks for a corrected invitation. No invitation recipient, membership, real driver approval or production financial data is changed by this release. No invite emails are sent as part of verification work.

## Validation and publishing

- Production-only clean npm install: plugin and its Tailwind peer resolve successfully.
- Tailwind configuration and generated modal/menu/spinner animation CSS checked.
- TypeScript, lint, unit and browser checks, including own-car/company-car onboarding, revision replacement, upload state preservation, missing requirements, popup/preview failures, repeated clicks, lost write responses, legacy document-to-verification flow and future-JWT login recovery.
- GitHub Check runs Chromium and WebKit; Database regression retains the existing verification, onboarding, tenant and privilege tests. No database migration is required for this release.
- Readdy: **Pull from GitHub → Publish**. Read `/release.json` to confirm the published build. A GitHub main push alone does not publish the Readdy site.
- Stripe client Checkout remains disabled; this release does not activate online payments or alter payment processing.
