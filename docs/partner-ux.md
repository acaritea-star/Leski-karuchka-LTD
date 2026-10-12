# Company and driver panel UX

Release: `2026.10.12-partner-ux.1`.

## Company landing

- Reports and cash reconciliation, drivers and vehicles are direct dashboard actions.
- Navigation separates daily work, team, finances and management. Platform actions remain super-admin only.
- Completed trip value is labelled separately from actual payments and reconciliation. The aggregation is unchanged.
- Mobile navigation locks background scrolling, focuses the close action, traps keyboard focus and restores focus on closing. Escape closes it.
- Operational warnings stay visible; diagnostic details can be expanded.

## Driver landing and preparation

- Actual status and the online/offline action have separate labels.
- Unverified offline drivers see the preparation action and cannot switch online. A revoked driver can still go offline and open an existing trip.
- Current trips, daily values and the accounting action precede the optional location map.
- No map is created on initial landing. Once opened it is retained when collapsed, avoiding duplicate loads within that page mount.
- The map observes existing shared GPS rather than requesting GPS itself. It does not represent road navigation; navigation stays in the trip screen.
- Invitation preparation shows data, training, documents and approval as four steps. Existing receipts, uploads and verification prerequisites are unchanged.

## Checks

The browser fixtures abort external traffic, including Google; use synthetic accounts and never send email. Chromium/WebKit scenarios cover tenant routing, company shortcuts, mobile drawer focus, driver landing, invitation preparation and package approval. Unit tests cover double clicks, confirmed online state, unverified restrictions, revoked verification with an active trip, and optional map reuse. Existing financial and overlapping-acceptance database suites remain required in CI.

## Publication

GitHub and the Readdy publication are separate. After importing the merged source, publish in Readdy and confirm `/release.json` reports this release. Review the company dashboard, driver home, invited preparation and an active trip on an actual phone. No database migration or authentication-provider change is part of this release.
