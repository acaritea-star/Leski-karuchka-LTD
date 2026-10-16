# Live driver tracking — 16 October 2026

An available driver normally uploads at most one moving fix per five seconds,
or one idle fix per fifteen seconds. Customer markers consume Postgres Changes
and bounded HTTP reconciliation. Presentation interpolation never becomes a GPS,
ETA or billing measurement. This release keeps those write limits and adds no
dependencies, schema changes, Broadcast stream or paid map polling.

## Findings and changes

1. Availability and tracking had the same stop condition. Both the Online/Offline
   mutation and the global GPS owner stopped the watch when `is_online` became
   false, including during accepted/arrived/in-progress rides. Read-only production
   diagnostics found an in-progress ride with an unavailable driver and a GPS
   measurement over forty minutes old. This matches a frozen position; it does
   not prove that every reported stall had the same cause.
   The GPS owner now keeps tracking an existing ride until its confirmed end,
   subject to location consent and browser permission. Offline still excludes
   the driver from new offers. The driver panels explain this distinction and
   expose GPS recovery during an unavailable active ride.
2. Permission was read before the explicit Online action, then only on window
   focus. A successful native prompt could leave the provider's cached state at
   `prompt`, preventing the continuous watch after its initial saved position.
   Starting work, including changing availability during an existing ride, now rechecks permission without another native permission
   request. An expired/denied permission still requires an explicit GPS action.
3. Both active-ride maps required a route or matching street geometry before
   drawing the car. A failed route and street request could hide valid GPS data.
   Active rides now prefer road geometry but fall back to the measured point,
   placing it immediately rather than animating a guessed chord across buildings.
   Road snapping resumes when geometry arrives. Anonymous nearby-car previews
   retain their existing strict road matching.
4. The installed Realtime SDK can acknowledge a channel before its Postgres
   extension is ready; extension errors need not close the channel. Tracking now
   waits for the extension's system confirmation or an actual valid GPS event
   before selecting the healthy HTTP cadence. Reconciliation runs about every
   15–18 seconds when healthy and 5–6 seconds when degraded, with the existing
   bounded timeout, exponential error backoff, jitter, single pending read and
   hidden/offline pause. Ordinary movement still arrives over the existing socket.
5. An authoritative empty location read was ignored indefinitely. It now clears
   the marker when the row/access disappears. Revision fencing prevents an empty
   read started before a new socket fix from clearing that newer confirmation.
   Viewer/ride scope changes return null immediately; late older coordinates
   cannot rewind the current marker. GPS reads use the existing `tracking.read`
   aggregate metric without recording coordinates or adding a telemetry stream.

The driver provider and panels share a full-row active-request query/cache and
the same in-flight read. Offline idle drivers get one recovery read rather than
another periodic loop; an unavailable active ride is reconciled every 15 seconds
while visible, including outside the requests panel. Explicit location-off and
account/role changes still stop location sharing. Realtime remains RLS-filtered.

## Evidence and limits

Read-only production checks confirmed `driver_locations` is in the Realtime
publication and retained the own-driver/company/assigned-customer policies and
restrictive staff-MFA policy. A rollback-only, session-local claims test confirmed
that the assigned customer at AAL1 can read the driver's row and an unrelated
customer cannot. It made no application writes and did not create or alter Auth
sessions. Real signed Auth/MFA and tenant isolation are covered by the database
CI suite, not by this claims-only smoke check.

The four-hour aggregate before the change contained 30 successful GPS writes
averaging 384 ms, 22 successful device acquisitions averaging 13,461 ms, and 20
failed acquisitions averaging 22,803 ms. These are historical mixed-device samples,
not an after-deployment benchmark. They support investigating device acquisition
and lifecycle separately from database write latency; they do not identify a phone.

Regression tests cover active Offline tracking, stopping after completion, idle
privacy, permission grant after Online, unavailable route/street services, socket
readiness and extension failure, empty/revoked reads, ordering, changing driver/
ride, stale GPS, resume, cancellation and bounded request counts. Browser tests
exercise the real app and SDK with synthetic GPS, renderer, HTTP responses and
WebSocket frames on Chromium and WebKit. External services are fulfilled/blocked;
no real rides, notifications or billable Google calls are created.

Validation covers 606 unit/component tests (97 files), lint, TypeScript,
the production build and unchanged legal-source digests. The current initial
JavaScript graph grows from 207,279 to 207,881 compressed bytes (+602 bytes);
initial plus booking grows from 241,402 to 241,900 (+498 bytes), measured with
`scripts/measure-booking-bundle.mjs` on a fresh isolated build. Retained historical
assets are excluded. The final packaged commit also runs the complete browser,
database, concurrency and real TOTP checks in GitHub Actions before merge.

Web geolocation cannot guarantee continuous fixes while the document is hidden,
the phone is locked or the OS suspends it. Existing Wake Lock/recovery remains;
neither this release nor the browser tests establish reliable background GPS on
physical iPhone/Android devices. A physical moving-device field trial remains
necessary after publishing the frontend.

## Primary research

- [Supabase Postgres Changes troubleshooting](https://supabase.com/docs/guides/troubleshooting/realtime-postgres-changes-troubleshooting)
- [Supabase Realtime protocol and extension errors](https://supabase.com/docs/guides/realtime/protocol)
- Installed `@supabase/realtime-js` channel implementation, shipped with the pinned SDK.
- [W3C Geolocation: watch updates for fully active visible documents](https://www.w3.org/TR/geolocation/)
- [MDN Screen Wake Lock lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)

Publish the packaged frontend through Readdy's GitHub pull/publish workflow and
verify release `2026.10.16-live-tracking.1`. Backend security enforcement remains
enabled. Existing historical assets must remain available for cached clients.
