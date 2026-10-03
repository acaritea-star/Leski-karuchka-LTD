# Nearby cars and road-aligned tracking

This release changes map behavior, retaining the existing UI and buttons. No npm dependency or Google Roads service was added.

## Preview before booking

CustomerHome enables the map preview only after account/request recovery, before an order is active or being created. Its center is the selected pickup or fresh shared GPS; saved addresses and a default town are not silently treated as the customer's current position. The existing Maps instance remains alive.

`public.nearby_cars` is an authenticated invoker wrapper for a private function. Only active CUSTOMER profiles can use it. Company and vehicle type match the current booking flow. The existing dispatch eligibility function excludes unverified, offline, busy, inactive, stale, inaccurate and wrongly assigned drivers. PostGIS adds a 1,500 m radius and a 12-car limit. Invalid or foreign coordinates are rejected.

No location-table RLS was widened. The response has viewer/day-scoped tokens, coordinates rounded to four decimal places (approximately 8–11 m here), heading, speed, accuracy and original source/server timestamps. It contains no driver/user IDs, names, phone numbers or vehicle registrations. Approximation is not anonymization: the feature still processes personal location data and customers can choose a pickup elsewhere. The privacy policy discloses the preview.

The client polls every 15 s, not per animation frame, and skips hidden tabs. Reads have a 10 s timeout, no overlap within a subscription, and a server-side per-customer 8 s gate. Snapshots expire at 45 s using original GPS and receipt times, including after network errors. Offline/busy changes appear on the next successful snapshot, not instantly. No Realtime subscription to the whole fleet is created. Maximum preview traffic is four bounded RPCs per visible customer minute; Supabase usage still scales with concurrent customers.

## Road geometry and animation

The active navigation route takes priority if the GPS point matches it. The known road is retained at arrival instead of clearing its geometry. OpenStreetMap drivable road segments provide a fallback and the prebooking geometry. GPS noise at a stop retains the position and direction; actual travel, including a short reverse at driving speed, remains possible. Preview cars spread interpolation over their 15 s sampling cadence; active tracking retains its 5 s animation window. Cars interpolate through connected street vertices and stop at received fixes. No extrapolated future metres are used for GPS, distance, ETA, trip status or accounting.

Street matching is local, indexed by small geographic cells and limited to nearby candidates. Direction and recent segment history reduce hopping between parallel streets. A bounded graph search respects one-way roads between segments. Disconnected street data causes a resync at a real matched point, never an animated chord through buildings. When no trustworthy road match exists the marker is hidden rather than falsely placed on a road. Poor GPS, parallel roads, outdated geometry, private access roads and community outages remain limits; this is not a guarantee of the driver's exact lane or navigable road.

Animation updates Maps markers directly, with at most 12 preview markers; no frame-by-frame React state, API requests or DB writes are added. Reduced motion, hidden tabs, reconnects and cleanup remain supported. Duplicate GPS timestamps do not ordinarily restart animation, and delayed geometry can correct a previously unsnapped marker.

## Free provider and cache

`road-geometry` explicitly authenticates the JWT with `admin.auth.getUser`, requires an active profile and uses the existing server API budget. Gateway `verify_jwt` is false because custom authentication is implemented in the shared authorize function; this is not an anonymous location service. Unauthenticated deployed POST requests return 401.

The server sends a coarse geographic bounding box to Private.coffee's public Overpass service, not individual coordinates, identities or driver IDs. A shared private cache lasts seven days. A 60 s lease prevents same-tile stampedes and a global cap permits at most 30 cold fetches/day. Timeout is 15 s, input/stream limits cap raw response at 4 MB, output at 30,000 points and a cache entry at 1.5 MB. The browser deduplicates tile requests and retains up to four tiles, retrying failures twice after 65 s. No paid Google fallback runs.

Public OSM snapshots in `public/roads/levski.json` and `public/roads/veliko-tarnovo.json` cover the respective town areas and load once from the site, shared across tiles. Town networks are cached separately. A verified online Tarnovo driver was hidden when the community tile cache had no geometry; the additional snapshot removes that dependency for this town. It contains no user locations. It was obtained as a one-off development download, not a runtime fallback to the main Overpass server. Its ODbL license, source update timestamp, bounding box and attribution are retained. Refresh the snapshot when local streets change; it is geometry, not traffic or live vehicle data.

Community hosting has no availability guarantee. Test-environment requests to the upstream provider timed out during this release; authenticated production retrieval needs observation on a real account. With missing street data, an available navigation route still works, but preview cars outside the bundled town areas wait for reliable road geometry. Cached roads remain usable during outages.

Usage policy: [Overpass instances](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) lists Private.coffee as permitting any project and asks large projects to notify support. Reassess policy and capacity before scale. Do not silently switch to overpass-api.de for commercial production; its documented policy differs.

OSM data is licensed under ODbL. Maps using these segments display the additional [OpenStreetMap attribution](https://www.openstreetmap.org/copyright) without removing Google attribution. Stored/exported road data and derived databases must retain the relevant ODbL notices and comply with its terms. Overpass server source is AGPL; this app calls its API and does not redistribute/modify that server.

## Deployment and validation

Apply both new migrations in version order, then deploy `road-geometry/index.ts` with `_shared/auth.ts` and `_shared/serviceArea.ts`; the MCP-generated versions match the repository migration filenames. Deploy frontend after server endpoints are active. Every frontend import is inside src; there is no dependency on backend filesystem paths in a frontend-only Readdy build.

Run `npm run check` and `supabase/tests/run.sql` in its rollback-only transaction. The nearby SQL suite covers access, rate limits, type, company, radius, online/busy/stale state, approximate coordinates and road-cache leases/cap. Frontend tests cover road matching, corners, jitter, reverse movement, delayed geometry, disconnected roads, arrival, snapshots, hidden tabs, errors and request bounds. Edge tests cover custom authentication, caching, fixed provider, coarse bbox, one-way parsing, response cap and failure without a paid fallback.

Advisors: new private tables intentionally have no client policies and deny direct access. Supabase reports [RLS enabled/no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) at INFO for them. There were no new performance findings. Existing project notices about public extensions/helpers and other policies are outside this release and were not claimed resolved.
