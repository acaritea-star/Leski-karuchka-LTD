# Accounting UX and regression audit — 16 October 2026

## What this screen represents

This is an operational ledger for each company's drivers. A completed ride's booked price is separate from money the driver declares received. Expenses and handovers reduce the calculated balance; a handover is not an expense. A company's confirmation verifies an existing income or handover and has zero balance movement. A correction adds a dated reversal and retains the original entry. The existing financial report version 2, exact numeric arithmetic, Sofia posting periods, evidence requirements and server authorization remain in use. No database migration is required by this release.

The screen does not calculate tax profit, payroll, invoices, fiscal receipts or actual counted cash. It does not introduce automatic collection, bulk confirmation or a new payment processor. See [financial posting integrity](finance-integrity-2026-10-10.md) for cross-period accounting and export limits.

## Inspection and public competitor research

The existing source, report/write RPCs, pending-operation recovery, CSV validation, company/driver rights and browser behavior were inspected before design changes. Primary public material reviewed on 16 October 2026:

| Source | Useful pattern | Application here |
| --- | --- | --- |
| [Uber earnings statements](https://www.uber.com/ci/en/earn/earnings-statements/) | Separates earnings, cash collection, transfers and adjustments in statements | Keep ride value separate from received money and balance movement |
| [iCabbi Pay](https://icabbi.com/platform/pay/) | Payment operations, investigation and reporting have distinct tasks | Short overview, separate history and trip views, explicit review action |
| [TaxiCaller online office](https://www.taxicaller.com/en/features/online-office) | Driver-specific reports and office reporting tools | Search a company's drivers and open an individual report |
| [Autocab driver accounts documentation](https://support.autocab.com/portal/en/kb/articles/job-processor-driver-accounts-365-accounts-legacy) | Select/filter driver accounts before processing transactions | Keep the selected driver visible and include company/driver scope in exports |

These are public descriptions, including Autocab legacy documentation, not access to current private competitor dashboards. TaxiMe and Yellow public pages did not provide enough current information for a reliable private accounting UX comparison. No claim of a benchmarked competitive advantage is made.

## Changes and reproduced defects

- Replace the dense overview with one calculated balance, three monthly amounts and expandable definitions. Keep booked ride value explicitly separate.
- Show driver actions for received money, expense and handover without opening a long inline form. Add expense-description shortcuts.
- Separate movements, trips and company driver summaries. Reset pagination on view changes and use the active collection's page count. Previously, visiting trip page 2 could hide a short money history.
- Open entry, review and correction forms in the existing native dialog component. With 25 company records, the previous last-row review form was about 2,362 px above the viewport. The new dialog remains reachable, scrolls with a short visual viewport, focuses the relevant field and restores trigger focus on cancellation.
- Clear amount, description, linked trip and action state after both successful posting and successful lookup of a previously uncertain operation. The old lookup path left the prior draft populated, allowing an accidental second manual declaration.
- Continue to persist the operation UUID before a write. During an uncertain result, lock new records and offer lookup or retry of the same operation. Guard parallel clicks and retain the pending operation's account/company ownership when changing read filters.
- Add a company-only driver picker, loaded on demand, with server-side search and 50-row paging. Both company and driver IDs are passed to the existing scoped report/export RPCs. A filtered company report never enables the driver's posting controls.
- Include company and driver scope in CSV metadata and company export filenames. Export still uses one validated, complete server snapshot and existing spreadsheet formula escaping.
- Make balance movement the prominent amount on each history row; label confirmation as zero movement and show the verified amount separately. Keep reasons, references, evidence and current correction status accessible in details.
- Replace the driver's report back-button font icon with a local SVG and a 44 px target.

## Verification

Local verification after implementation:

- `npm run check`: lint, 570 unit/component tests, TypeScript and production build.
- Six accounting browser scenarios in both Chromium and WebKit: long-history review placement/focus, expense form/short viewport, company driver search and scoped CSV, independent pagination, delayed company confirmation and correction with evidence, and a lost payment response followed by recovery without a second write.
- Viewport checks at 320 px, 390 px and desktop width; keyboard Escape, focus restoration, required document references and disabled fields during pending writes.
- Regression test added for the stale draft after successful pending lookup, company+driver read scope, and CSV scope metadata.
- Production metadata inspected read-only: report/export use the shared invoker implementation; a mismatched company/driver pair is rejected. `driver_money_entries` has RLS and a scoped SELECT policy. Authenticated direct INSERT/UPDATE/DELETE are denied; the privileged core is not executable by authenticated or anonymous clients; public financial RPCs deny anonymous execution. No synthetic financial entries were written to production.

The release gate also requires the repository Check and Database regression workflows on the final branch head. Database checks use a disposable localhost Supabase, including cross-company rights, historical corrections, exact cents, evidence bypass attempts, export completeness and concurrent money operations. Workflow results are linked in the pull request/release record.

## Size, activation and rollback

No dependencies, intervals, realtime subscriptions, notification channels or extra accounting polling were added. Report pages remain 25 entries/outcomes, driver summaries up to 50 groups, and CSV up to 10,000 records per collection. Driver roster search only loads when its picker opens, uses the existing query cache and waits 250 ms after input. Returning to a fresh cached all-company report does not require another network request.

Publish through Readdy: Pull from GitHub, then Publish. Verify `/release.json` reports `2026.10.16-accounting-ux.1` and `accountingUxVersion: 1`; a GitHub merge by itself is not proof the hosted frontend is active. Keep existing notification, financial, legal and permission release flags intact. Historical hashed assets are retained for clients with an older entry point.

Rollback is a frontend revert and republish of the prior release. No ledger rows, schema or financial function definitions should be removed or restored for this UI release. Existing pending financial operations must retain their saved UUIDs and remain recoverable.
