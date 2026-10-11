# Invitation links and firm fleet reliability

An explicit invitation is checked against the confirmed email in `auth.users`
before redirecting an existing company administrator, driver or platform administrator.
A different account, wrong kind, revoked/expired pending invitation or outdated accepted
membership receives a denial without changing its existing role. `/app` still opens
that account's authorized panel. Accepted membership survives the invitation's initial
14-day pending window; this release does not revoke established memberships by expiry.

Firm driver lists use an authorized, RLS-preserving `company_driver_page` RPC: one
bounded response of 50 rows, exact count, literal name search, stable pagination and
location lookup only for the current page. Reads never select all profiles or rely on
the browser hiding a foreign company. A company/identity switch resets open details,
search and invitation state. Mutations retain the original driver/firm predicates.

The map, driver list and dashboard share a 45-second GPS freshness rule, a 30-second
future-clock allowance and active-account check. A fresh heartbeat does not make an
old device fix current. Missing historical device timestamps are visible as offline,
without failing the whole map. The map continues at 10 seconds, driver pages at 15,
dashboard at 30; hidden/offline query polling follows React Query's normal pause rules.
Local five-second freshness ticks make no API calls. An expired dashboard response
does not claim a current online count. A company-less map does not load Google Maps.

Synthetic PostgreSQL tests cover two companies, direct RLS and RPC attempts, 61 drivers
across two pages, literal wildcard search, GPS expiry, inactive accounts, forged JWT
email/metadata, confirmed invitation identities, correct existing-role routing and
anonymous denial. UI tests cover paging/search, firm changes with an open modal,
verification writes and refresh. Browser mocks prevent paid Google calls and email.
`restore-tenant-reliability.sql` restores the preceding read functions and link handling;
republish the matching previous frontend when using it. It deletes no business records.

See Supabase's [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).
