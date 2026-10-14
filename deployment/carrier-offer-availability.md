# Carrier offers and dispatch flow

Customers now go from pickup and destination directly to exact carrier offers.
Category selection, editable route and address swap stay on that screen. Offers
are sorted by price and a search field appears when there are more than six.
The selected firm's name and exact price remain above/in the fixed order action.

The old availability response counted drivers only by service class. A different
firm's available car could therefore leave an unavailable selected offer enabled.
`private.marketplace_availability` now also returns unique eligible
`company_id` / `vehicle_type_id` / `service_class` tuples from the same materialized
driver snapshot. It retains category counts for existing clients and returns no
driver identifiers, locations or per-company driver counts. Existing customer
authorization, function grants and driver eligibility rules are unchanged.

The customer requires a fresh, matching tuple to select/book a carrier. Losing
availability keeps the current selection and price visible but disables ordering;
another carrier or class cannot silently replace it. Switching firms/categories
or refreshing availability reuses the priced route. Refreshing expired quotes is
explicit. Submission still checks eligibility on the server, since a car can take
another trip after the availability snapshot.

Pending requests name their chosen firm using the saved fare snapshot. A server
timeout offers another quote for the same route, including after page recovery.
The customer must explicitly order again. Existing carrier-specific dispatch,
atomic first acceptance, idempotency and fare accounting remain in force.

Validation includes parser and customer integration regressions, mobile browser
scenarios with 14 firms, changed availability, route reuse and small screens, plus
rollback-only SQL fixtures proving two eligible drivers of the selected firm both
receive the offer. Foreign firms, busy/offline/unverified drivers, stale or distant
locations, inactive profiles/vehicles and a different category are excluded.
Existing real overlapping acceptance and accounting tests run in disposable CI.

Rollout order: verify CI, apply `carrier_offer_availability`, then publish the
frontend through Readdy's GitHub pull and publish. GitHub merge alone does not
publish the website. The response is backward compatible with the prior frontend.
For rollback, restore the previous frontend first, then apply
`carrier-offer-availability.rollback.sql`. New clients fail closed if the carrier
list is missing; never fabricate availability from category totals.

Production database migration: 20261014130621_carrier_offer_availability. The installed function body matches the reviewed SQL and its grants are unchanged. Security and performance advisor findings are unchanged from the pre-release snapshot.
