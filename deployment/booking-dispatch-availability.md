# Booking dispatch availability

Release: `2026.10.12-dispatch-availability.1`.

## Behaviour

Unassigned customers can explicitly select a public active operator. Company-bound customers retain their existing operator scope. Choosing an operator does not modify profile membership or administrative permissions.

The new `booking_availability` API exposes category IDs and bounded aggregate counts for the selected operator and pickup. It uses `private.eligible_drivers`, including actual vehicle category, online status, verification/documents, current server and device GPS timestamps, accuracy, dispatch radius and no active trip. Categories with no reachable driver are disabled. Availability is checked every 15 seconds and fails closed when unconfirmed or stale. These reads do not call Google.

Creation locks the quote, returns its existing request first for idempotence, and checks eligible drivers again before inserting a new request. A missing driver returns a clear error instead of creating an unserviceable pending request. Availability remains a point-in-time observation; a driver can reject, disconnect or become busy afterwards. Existing deadline and atomic acceptance logic remain in force.

Nearby preview resolves an unassigned customer's operator from the selected category. Existing customer assignment, coarse positions, privacy, radius, limit and read throttling remain intact. Driver home and requests identify the operator/category and separate online intent from confirmed GPS readiness. A single phone with separate browser/PWA profiles does not provide two reliably active foreground GPS clients.

## Regression

Parser and UI checks cover unavailable categories, stale snapshots, operator selection, a driver lost at submit and no false searching state. GPS checks prevent late callbacks/acknowledgements from one account affecting the next. SQL checks cover private aggregate responses, selected-operator map scope, offlining, unsupported categories and quote idempotence. Existing financial, geographic, role/isolation, document and concurrent-acceptance suites remain required.

Older geographic test fixtures now make the original booking serviceable before moving the driver, and use monotonic device timestamps so the production out-of-order GPS guard is exercised correctly. The independent foreign-operator scenario has its own eligible synthetic vehicle and driver.

## Deployment and rollback

Apply `20261012105718_booking_dispatch_availability.sql` only after regression passes, then publish the merged frontend through Readdy. Verify `/release.json`. The migration is transactional and preserves profiles, historical requests, trips, prices and reports. Existing modified function ACLs are retained. The new public wrapper is invoker security; its private definer checks the active customer and operator scope and exposes no driver identity or raw GPS.

The rollback file restores the two previous live function definitions and removes the new availability endpoint. If rolling back SQL, also publish the previous frontend: the new frontend intentionally blocks bookings when availability cannot be verified. No request/profile/history rows are deleted.
