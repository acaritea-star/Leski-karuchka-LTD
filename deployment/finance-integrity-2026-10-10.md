# Financial posting integrity — 10 October 2026

## Financial meanings

- A completed ride has a **booked value**. Cancellation never turns a quote into revenue. A booked value is not proof of payment.
- The driver explicitly records income, expenses and handovers. The new ride shortcut only prefills an editable form; it never records receipt automatically.
- A company administrator checks income or receipt of handed-over cash against a cash count, cash book, receipt or payment reference. Confirmation does not count the money a second time.
- Reversals are separate negative postings dated when the correction is made. Prior periods remain unchanged. The original entry, confirmation and reason remain visible.
- A driver may reverse their own unconfirmed entry. Only the appropriate company administrator (or authorized super administrator) may reverse a confirmed income/handover, with evidence and a reason. Legacy endpoints cannot bypass the evidence requirement.
- A corrected linked ride payment can be recorded again. There may be only one active linked income entry per ride. Partial receipts need a corrected cumulative entry; multiple independently linked installments are not implemented.
- Balances are **computed from entered records**: opening + income − expenses − handovers = closing. They do not establish actual cash on hand, tax profit, payroll, debts or opening cash that has never been entered.
- All money is EUR with exact PostgreSQL numeric arithmetic. Displaying a booked value preserves cents; it does not round to whole euros.
- Posting periods use local midnight in Europe/Sofia, including daylight-saving changes. No client-supplied backdating is accepted. A delayed offline retry is dated when the server records it.
- Monthly amounts follow posting dates. The line's reversal/confirmation status and ride reconciliation show the **current** state; they can include a later month's action. Confirmed amounts in a month may therefore refer to an older income/handover.

## Hand-check example used by the database regression

| Posting | September | October |
| --- | ---: | ---: |
| Income and its correction | +100.25 | −100.25 |
| Expense and its correction | +10.10 | −10.10 |
| Handover and its correction | +60.00 | −60.00 |
| Opening balance | 0.00 | 30.15 |
| Change in calculated balance | +30.15 | −30.15 |
| Closing balance | 30.15 | 0.00 |

September's income is confirmed in September. The handover is confirmed in October. Reversing both in October leaves September's financial totals unchanged. The October confirmation/reversal of that handover nets to zero confirmed handover, without losing either audit line.

## Export and failure behavior

`accounting_report` and `accounting_export` use a shared STABLE, SECURITY INVOKER implementation and table RLS. The complete export is one database statement snapshot, with scope, period and extraction time. It includes signed corrections and a separate balance movement column; confirmations and booked quotes do not create cash movement.

Interactive pages contain 25 entries/outcomes and up to 50 driver groups. Export includes up to 10,000 records in **each** collection. Larger exports explicitly fail instead of silently truncating. A large-company async export/archival pipeline is not implemented; monthly pages still require scanning the relevant ledger for opening balances.

The browser verifies the report version, scope, period, collection completeness and balance identities. A failed or malformed read cannot be displayed as a zero report. Uncertain writes retain their operation ID, are checked against the server and can be retried explicitly. Concurrent distinct IDs for the same linked ride are rejected; separate unlinked manual declarations are not automatically deduplicated by business intent.

## Test/deployment evidence

Verified source: `105efbde47936e8d4fbd24fdce30c8653e08d231`.

- [Check run 38025486227](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38025486227): lint, 407 unit/component tests, type-check/build, legal source digest, Edge Function Deno checks, Chromium/WebKit browser scenarios.
- [Database run 38025486295](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38025486295): all SQL suites and actual concurrent-connection checks passed.
- The 506-entry export plus paged-report checks took 64 ms in the disposable test database. This is a small synthetic check, not a production-scale load guarantee.
- Production migration `20261010045324_financial_posting_integrity` was applied successfully at 2026-10-10 04:53 UTC. All six deployed function body hashes match the tested migration. Anonymous execution is denied and the privileged write core remains inaccessible to authenticated clients.
- Existing financial entry count was zero before deployment. No synthetic financial data was written to production.
- Advisor findings remain on pre-existing schema areas; the deployment does not claim a warning-free project. The financial table's pre-existing missing actor foreign-key index remains a performance advisory for future actor deletion workloads; current report indexes and amounts were not altered.

The first database attempt stopped on missing IDs in synthetic volume fixtures; this was corrected and the entire suite rerun successfully. The financial calculation and permission scenarios had already passed before that fixture insertion. Tests use only the disposable localhost Supabase and blocked/mocked browser network; they do not call Google or write synthetic financial data to the live project.

Coverage includes cross-month reversals, confirmed corrections, proof bypass attempts, rights/isolation, exact cents, Sofia/DST boundaries, 506-entry export and pagination, refusal above the export cap, 12 concurrent retries and a same-ride race, lost-response recovery and CSV download in Chromium/WebKit.

## Meeting walkthrough after publishing

Use designated demonstration accounts and real/explicitly identified demonstration entries, not invented historical revenue. A production demonstration creates a genuine audit history.

1. Driver: open the financial report and show booked ride value versus actual declared payment. Confirm that a cancelled ride contributes no booked turnover.
2. Driver: record a received amount, an expense and a handover. Check that the handover reduces the calculated balance, without becoming an expense.
3. Company administrator: confirm the income and handover against the chosen evidence. The declared income must remain unchanged.
4. If demonstrating a correction, reverse a wrong unconfirmed entry from the driver account; a confirmed entry requires the company correction action. Then add the correct amount. Both lines must remain visible.
5. Export CSV and check the opening balance, movement and closing balance against the same report. Reload and verify that there is no duplicate record.

## Release/rollback

Deploy the tested database migration before publishing the frontend that requires report version 2. `deployment/restore-finance-2026-10-09.sql` retains exact prior function bodies and does not remove financial rows. Restoring it also restores the old cross-period calculation defect; it is an emergency compatibility rollback, not a data correction. If restoring the database behavior, restore the matching pre-release frontend as well. Financial reversals written after deployment must remain in the ledger and be reconciled; do not delete them.

The website is published through Readdy. A GitHub main update alone is not proof that the hosted frontend has been rebuilt. Verify `/release.json` after Pull/Publish.
