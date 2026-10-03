# Request accounting release

Reports are per request and calendar month in Europe/Sofia; no shifts are introduced. Driver availability controls are unchanged.

## Behaviour

- Terminal request transitions create one server-owned outcome with the previous stage, cancellation actor/reason, assigned driver, timestamps and quoted distance. Cancellation never becomes booked revenue.
- Existing closed requests are backfilled as reconstructed records. A historical vehicle or authenticated actor is not invented.
- Booked amount, driver-declared income, declared expenses, declared handovers and company-confirmed handovers are separate measures. Income minus expenses is a declared personal calculation, not certified profit or a tax document.
- Drivers can add money records and link income to their own completed request. Only one unreversed linked income is allowed. External income is explicitly unlinked.
- A different company administrator confirms receipt of a handover. Driver corrections append a reversal; confirmed handovers cannot be reversed by the driver.
- Request outcome and money records have no client write/update/delete grants. RLS restricts reads to the driver and relevant administrators; write RPCs validate active identity and ownership on the server. Operation UUIDs allow retry without duplicate writes.
- Reports use database aggregation, indexed month ranges and 25-row pages. CSV exports all pages, up to 10,000 rows per collection, with formula-injection protection and count/identity checks for concurrent changes. This is not a transactionally frozen financial export.

## Validation

`npm run check` covers lint, types, unit/component tests and production build.
`supabase/tests/run.sql` runs the core lifecycle, accounting, geography/payment, dispatch and competing-acceptance scenarios in one rollback-only transaction. Accounting assertions cover cancellation provenance, duplicate money submissions, reversals, role/company isolation, independent receipts and in-progress cancellation restrictions.

## Limits

GPS history and measured trip distance are not introduced. Phone movement cannot prove cash payment or every off-platform ride. No automatic fraud verdict, cancellation fee, payroll share, tax calculation or independent-driver legal status is inferred. Declarations are visible to the driver's linked company; this is disclosed before entry and in the privacy policy. Historic data and SQL administrator access are not cryptographically tamper-proof.

All reported sums are EUR, matching the current application. Money-entry timestamps are server-generated; retroactive financial entry dates are not yet supported.
