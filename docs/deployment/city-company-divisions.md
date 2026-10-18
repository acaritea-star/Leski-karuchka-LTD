# City company divisions

A division is an ordinary company tenant with an immutable, direct `parent_company_id`. Existing companies, prices, memberships, requests and money entries are retained. Divisions share the parent's management access; their drivers, vehicles, prices, requests, receipts and financial records retain their own company IDs.

The parent COMPANY_ADMIN can select its headquarters or a direct division, create drafts, invite named local managers, manage tariffs and read a combined monthly report. A local manager can manage only their own division. Drivers retain their exact company membership. Unrelated companies gain no access. Existing staff MFA checks apply to every new staff operation. Only one hierarchy level is supported; companies cannot be attached or reparented.

## Configuration

Open **Градове и подразделения** from the parent panel. Add a city and choose a centre and radius (0.5–30 km). These circles are operational pickup zones, not municipal boundaries or proof of a transport permit. Finish each division's legal, permit and tariff setup before activation. The headquarters may remain a non-operating draft while its divisions operate.

Creation uses a client-generated UUID and a locked parent row; retrying the same request returns the same draft. A lost response asks the user to refresh before trying again. City names are whitespace-normalized and unique within a parent. New divisions start inactive, with document checks required, no copied permit or verified status, no public driver applications, and no commercial rates assumed.

For overlapping configured sibling zones, the closest centre wins, with a deterministic ID tie-break. A paused configured city's zone stays reserved; another city or headquarters does not silently supply a different tariff. Draft divisions reserve no territory. A ride belongs to the division selected at pickup, including when its destination is in another city. Its saved exact quote and payment stay with that division after tariff edits or a pause.

Optional separate night rates apply 22:00–06:00 in `Europe/Sofia`, with server time and DST handling. With all four night fields NULL, the existing base rates apply throughout the day. The per-minute component still prices the whole route duration; it is not a waiting-time meter.

## Reports and notifications

The combined report calls the same accounting calculation used by each existing company report. Summary mode avoids building or transferring ride, money-entry and driver-detail lists. SQL sums exact numeric values; the client verifies scope, period, currency, payment subtotals and totals before rendering. Local managers cannot call the parent report. Private financial attachments retain the existing tenant and Storage policies.

Company notifications go to active local managers and the active parent owner. The division name identifies the city; opening the notice selects that division before loading its page. Existing notification channels are reused. No new polling, Realtime subscription, package or map load is added.

## Deployment and verification

1. Run Check and Database regression against the source commit. The SQL fixture rolls back all synthetic data and covers creation, hierarchy, RLS, MFA, invitations, private financial/documents Storage visibility, pickup isolation, exact cross-city booking and atomic payment, day/night/DST, reports and notification routing.
2. Apply the additive `city_company_divisions` migration. Record the actual production migration version in the checked-in filename/release metadata. Recheck grants, constraints, indexes, advisors and unchanged existing companies.
3. Deploy `google-routes` and its shared dependencies, preserving its existing JWT verification setting. Both quote paths read server-selected effective rates. No paid Google request is necessary for deployment verification.
4. Build the production frontend from the verified source, retain historical published assets, run final checks and merge to main. Publish that frontend through the existing hosting flow and check `/release.json` before claiming the new UI is live.

No production division, city tariff, email invitation or synthetic ride is created by this release. The existing Лески Каручка company remains a draft until its owner supplies the real operating details. The separate existing ride-payment enforcement flag must retain its current value until the corresponding public driver checkout has been published and verified.
