# Company entry and platform administrator context

Base: `4824e4c10bcccd89ce0628b9d9eabdf42358fae2`.
Verified runtime: `3f42c83042a93689a5791f7b071c3935336c43d8`.
Release marker: `2026.10.11-company-access.1`.

## Findings

The October 11 production inspection found one active `SUPER_ADMIN` with no
company assignment and no `COMPANY_ADMIN` profiles. A read-only transaction
using that administrator's authenticated database role confirmed
`is_super_admin() = true` and visibility of both existing companies. No account
was promoted, demoted, assigned to a company, or impersonated for a write.

Creating a company inserts a company record; its triggers validate carrier
identity, update timestamps and seed a vehicle category. They do not change
the creator's profile. The confusing behavior came from the interface:

- The sidebar used the selected company's name as the panel heading.
- Without an explicit choice, the newest company became the active context on
  every refreshed list, including immediately after company creation.
- The public site's app link sent `COMPANY_ADMIN` to the customer page.
- Company administrators saw platform-only menu items that route guards rejected.

## Behavior

- `/company/login` reuses Google/Facebook OAuth and the existing terms notice.
  A bounded, same-origin OAuth return leads to `/company` for a profile check.
- `SUPER_ADMIN` lands at `/admin/companies`. The platform role remains visible
  while managing any company. `Управлявай` explicitly chooses a firm's dashboard.
- `COMPANY_ADMIN` lands at `/admin/dashboard` for its assigned company. Company
  queries include that ID and the UI filters returned rows again. There is no
  company switcher or platform-only navigation for that role.
- A customer, driver, or company administrator without an assignment receives
  an explanation at the company entry and can contact support or leave the
  account. Visiting the entry does not create a company or change any role.
- A super administrator's selection is pinned and remembered in this browser
  tab using account/role/company-scoped session storage. Unavailable storage
  falls back to memory. Stored IDs are validated against the current query.
- Super administrators can select inactive companies to administer them;
  dispatch eligibility and verification checks are unchanged.
- Platform-wide forms do not remount when the company list changes. Company
  forms still remount on identity/company changes to discard stale drafts.

## Authorization and limitations

No database migration, grant, RLS policy, auth setting or dependency changed.
The existing database profile remains the authority. A company contact email
does not grant account permissions. A specific account must be deliberately
assigned as company administrator by the platform operator. This release does
not add manager provisioning, multiple simultaneous profile roles, or a way to
act as another person's driver/customer account.

Personal training/terms acceptance and financial evidence retain their existing
checks; selecting a company does not bypass them. The production security
advisor groups were unchanged from the prior release; this is not a claim that
all existing database warnings have been resolved.

## Verification and rollback

Local lint, TypeScript, production build, legal-source consistency, and all 429
unit/component tests passed. Local Playwright could not launch because browser
binaries are unavailable; GitHub CI supplies Chromium/WebKit. Added browser
scenarios cover company creation without role changes, stable selection through
reload, assigned-company navigation, and rejection of an unassigned account.
Browser API fixtures block external traffic, including Google APIs.

Both staged CI workflows passed for the verified runtime:

- [Check: lint, 429 tests, build, legal source, Deno and 20 Chromium/WebKit scenarios](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38121650449).
- [Database regression, including the new role assertions and 12 concurrent financial retries](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/38121650452).

The database suite adds real authenticated-role assertions that creating a
company retains super-admin identity and that a company administrator cannot
promote itself or change its own tenant. These fixtures run in disposable
Supabase and roll back; no synthetic company/profile was written to production.

For rollback, revert this frontend release to the base above and republish.
No database rollback is necessary. Existing `/admin/*` links remain compatible.
GitHub publication and website publication are separate; confirm the deployed
`release.json` after the hosting provider rebuilds the site.
