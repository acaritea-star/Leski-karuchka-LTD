# Company category and vehicle onboarding repair

The vehicle modal required a category but offered only “Без тип” for a newly created company. Production inspection found that КосиКар EOOD had zero vehicle categories: company creation inserted only the company, while the vehicle RPC correctly required an active category from that same company. The UI then blamed both the category and the already populated registration number.

## Resulting behavior

- Company insertion creates one active “Стандарт” category (capacity 4, multiplier 1.00) in the same database transaction. It uses the firm's own entered tariff without a price increase.
- The migration repairs only companies with no categories at all. It does not replace existing categories or reactivate deliberately disabled ones. Company tariff values are not updated.
- The trigger runs with the caller's privileges and existing RLS. It has no security-definer bypass and is not a callable public RPC. Anonymous users, customers and foreign company admins receive no new write rights.
- Vehicles offer only active categories belonging to the selected company. A sole active category is selected automatically. Missing registration and missing category have separate messages.
- Company changes close and reset the old vehicle form. Read failures block saves, expose a retry action and do not masquerade as an empty category list. Independent reads run in parallel; the number of data requests does not increase.
- The existing atomic vehicle-assignment RPC still validates category/company membership, prevents vehicle changes during an active trip and keeps document verification requirements.

## Verification and deployment

Applied production migration: `20261010162446_company_vehicle_category_bootstrap.sql`. The local Supabase CLI is unavailable; deployment used the authorized Supabase MCP migration tool and the repository filename matches its recorded version.

Added seven component regression cases, a browser vehicle-and-driver assignment scenario for both mobile engines, and a rollback-only SQL suite using real database roles. Every browser network request outside the local synthetic backend is blocked. Database fixtures run only in the disposable GitHub CI database.

Verified source: `700b96ad9a2611f55d9bd2fba20ae857dd284283`.

- Check run `38067214418`: lint, 414 tests across 75 files, TypeScript/production build, legal-source check, Deno checks and all 10 mobile Chromium/WebKit browser scenarios passed.
- Database regression run `38067214493`, attempt 2: full SQL regression suite and financial concurrency checks passed. The first attempt failed before tests because an infrastructure port was occupied. The identical migration also passed the initial source run `38066886958`.
- The new browser scenario explicitly accepts the current legal notice through its normal UI before saving the vehicle; it does not force clicks through the notice.
- Production postflight: КосиКар EOOD now has one active Стандарт category with capacity 4 and multiplier 1.00. Its tariff remains base 2.10 EUR, 1.22 EUR/km, 0.15 EUR/min and minimum 0. Existing Евро Такси category IDs, multipliers and tariff values match the preflight snapshot.
- The deployed helper source matches the tested SQL byte for byte, uses security invoker, and denies direct execution to both anon and authenticated. The trigger is present on company insertion. Security advisor findings match the preflight categories/counts; existing unrelated findings remain.
- No synthetic production profiles, vehicles, requests or financial entries were created during validation.

Release marker: `2026.10.10-vehicle.1`. GitHub publication does not by itself prove that the Readdy-hosted frontend has pulled and published this revision.

## Rollback

`restore-company-category-bootstrap-2026-10-10.sql` removes only the new trigger/helper. Created categories remain because they can already be referenced by vehicles, quotes and rides. No profile, vehicle, ride, financial entry or tariff is deleted or rewritten.
