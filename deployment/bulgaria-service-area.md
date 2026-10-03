# Bulgaria service area and confirmed driver availability

Service operations are limited to the embedded Bulgaria polygon from Natural Earth 1:10m (public domain), retrieved from https://github.com/datasets/geo-countries/blob/master/data/countries.geojson on 2026-10-03. It is a cartographic boundary, not survey-grade border data. Border cases require review against finer data; no outside-country buffer is applied.

The same polygon is used locally in frontend/Routes Edge Function and with PostGIS in the database. Places autocomplete requests only Bulgaria; GPS, recent/address selection, route endpoints and waypoints are checked locally. New driver locations, quote endpoints and request endpoints are checked by database triggers. Going online requires a fresh GPS fix in Bulgaria with accuracy <=100m. Going offline remains available. These additions keep existing RLS/authentication and cash/dispatch guards.

The public website and account sign-in remain accessible abroad; this is a geographic service restriction, not an IP country wall. Client GPS is not proof against device spoofing. The existing polling/GPS cadence is unchanged and no external country lookup is performed at runtime.

Availability UI uses the confirmed updated driver row immediately, cancels stale profile fetches before cache replacement, and blocks duplicate clicks. Existing visual design and buttons are preserved. The full driver update now has a 10-second request deadline.

Applied to project rzjyvxmfqnnxglmgnvma using the checked-in migration. Deployed google-routes version 6 with existing custom authentication and verify_jwt=false preserved. Rollback-only database tests rejected outside GPS, quote and request endpoints, and online without valid local GPS; authenticated access to the helper was checked. No real user records were changed by these tests.
