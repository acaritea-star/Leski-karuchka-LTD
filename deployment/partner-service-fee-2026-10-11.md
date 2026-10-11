# Partner service fee information and driver training

Release: `2026.10.11-partner-service-fee.1`.
Verified source: `3563ac0883b3a2fd0177dab221ee509b4f544d49`.

## Public model

`/company-partner` describes **Такса за обслужване към Лески Каручка**: 8–12% of actually paid fares for completed platform-sourced trips, excluding tips and refunded amounts. Own-company trips recorded only for reporting have no such intermediary fee. The range includes VAT when applicable; this is not a claim that the operator is VAT registered.

The precise rate, capacity/volume review period and payment deadlines must be agreed with the firm before paid activation. Higher platform-sourced paid volume informs a lower negotiated rate. No volume thresholds or automatic tier qualification are implemented or promised. The firm is the contractual payer; its separate arrangement with its drivers remains distinct. The 100 € example shows turnover after the fee, before operating costs, taxes and driver remuneration.

The public menu, footer and pricing page link to the new page. The inquiry CTA opens the existing contact form with “Фирмено партньорство” selected; it never sends an inquiry automatically. SEO metadata is restored on leaving a route, preventing the partner canonical from leaking into other public pages. Sitemap and llms.txt include the new route.

## Driver preparation and database

- Terms: `2026-10-11-driver.1`; training: `2026-10-11.1`.
- SHA-256: `f2f994314fedf8d908b2ea1bbaa40268bc2ba58f4492ea6c066194930e4fd367`.
- A sixth topic explains the rate, payer, exclusions and 100 € example. Existing safety, cash and responsibility questions remain server checked.
- Migration: `20261011081118_partner_service_fee_training.sql` (production-generated history timestamp). The candidate scaffold was generated with `supabase migration new`; its subsequent PostHog telemetry was rejected by automatic approval review. That command was not retried. SQL publication used the Supabase connector.
- The migration locks version publication and switches the current version in one transaction, requiring the exact preceding version/hash. It changes no authorization, driver status, tariff or financial ledger.
- Previous policy content, hashes and personal acceptance receipts remain. Before and after publication: 3 drivers, 2 verified, 0 online; the 1 existing receipt remains under its original version. Current database document was compared to the frontend source and matches.
- Existing verified drivers are not automatically unverified or interrupted. New verifications require personal completion of the current preparation; an old receipt does not silently accept unseen terms.
- Recovery: `deployment/restore-partner-fee-training.sql` switches the version selector back under a guarded transaction, retaining both documents and all receipts. If recovery is needed, restore the corresponding frontend source/manifest too; do not delete accepted versions.

This release provides pricing information and personal training evidence. It does **not** activate billing, create invoices, charge customers, post commission/cash entries or authorise deductions from a driver's personal earnings. Paid firm activation still requires the actual partner agreement and checked operator details. `legalReleaseApproved` remains false.

## Verification

Candidate GitHub runs:

- Check: [38123685585](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38123685585), job `114423479175`: lint, 431 tests in 77 files, TypeScript, production build, legal source digest, Deno edge function checks and 24 Chromium/WebKit browser scenarios.
- Database regression: [38123685564](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38123685564), job `114423479083`: disposable Supabase suites, old/new receipt retention and stale-client rejection, onboarding, company isolation and 12 concurrent financial retries yielding one record.
- Local Chromium checks: training lost-response recovery, candidate preparation, admin package approval, partner page at 320/1024/1440 px, contact topic, menu/footer/pricing links and metadata cleanup. External requests were blocked; no Google Maps API requests or real form submissions occurred.
- Production readback: two policy versions, only the new one current; original receipt and driver status counts unchanged; six existing advisor groups unchanged.

## Hosting

GitHub `main` is the source publication. The domain's `/release.json` was checked and still reported `2026.10.10-onboarding.1`. Readdy Publish is separate and was not executed or claimed. After publishing the latest GitHub source, verify `/company-partner` and release `2026.10.11-partner-service-fee.1` on the live domain.
