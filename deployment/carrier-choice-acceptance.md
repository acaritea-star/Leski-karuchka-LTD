# Exact carrier choice and GPS recovery

Customers compare named, exact offers in a fourth booking step. The cheapest offer appears first. Choosing a different carrier changes only the saved quote selected for booking; it does not buy another Google route. One server route prices all eligible carrier/categories. Each exact quote has its own immutable company, actual vehicle category, amount, breakdown and customer owner. Booking and push/Broadcast eligibility use the chosen company/category. A carrier is never silently substituted when a refreshed offer disappears.

Older shared-marketplace clients/quotes remain compatible until their normal expiry. Existing assigned rides, customer ownership, firm reports and payment evidence remain unchanged.

## Acceptance and GPS

The public acceptance RPC delegates to an explicitly authorized private operation. It checks active driver identity, locks request then driver, handles owned retries, and rechecks closure, online mode, active ride, measured/server GPS age, declined offer, documents, vehicle and radius. It returns a GPS-specific failure instead of allowing an RLS-hidden stale row to masquerade as a taken request. Different selected carriers cannot read or accept the offer. The shared-marketplace acceptance keeps its existing saved-fare assignment operation. Race losers return a closed-offer explanation; one driver cannot hold two active rides.

Both driver screens recheck the local request deadline before and after a needed GPS refresh. They navigate/cache a ride only after authoritative assignment to the same driver. Home separates offer errors from GPS availability; it no longer keeps a missed-offer error in the online/GPS control. A manual GPS refresh is available without an offline/online round trip. Account changes fence late acknowledgements.

A valid shared watch fix can resolve a stalled one-shot read. Two stale browser readings trigger bounded recovery under the same 24-second deadline. Up to three native reads are allowed; original device timestamps remain unchanged. A measured fix younger than five seconds may be reused explicitly. A transient native timeout cannot hide a still-current, server-confirmed driver position. Startup and restoration use a separate acquisition state: ordinary waiting and a first coarse fix appear as an amber status, never a red error. Dispatch stays unavailable until an accurate position is confirmed by the server. Permission, unsupported-device and real write failures remain explicit. Repeated healthy acknowledgements reuse the same context state instead of repainting driver consumers. Hidden/frozen pages, permission denial, old measurements and imprecise locations remain unavailable for new dispatch; web/PWA background GPS is not promised.

## Deployment order

1. Run unit/build/lint, browser fixtures, Edge type checks, SQL lifecycle/security and real overlapping acceptance tests against the disposable database. External Google/email traffic is blocked; no production test records.
2. Apply the migration transactionally with a five-second lock timeout. Saved pre-release definitions and grants are in the rollback file; table data and policies are not changed.
3. Deploy backward-compatible google-routes with its existing custom authentication and verify_jwt=false. Retain the previous Edge version privately for rollback.
4. Merge the reviewed source and release bundle. Sync/publish the frontend through the hosting project. Verify the public release manifest independently of GitHub.

## Rollback

Restore the previous frontend and Edge function, then apply carrier-choice-acceptance.rollback.sql. It restores the exact two pre-release public definitions, removes the new private helper and preserves all existing grants, quotes, requests, trips and financial evidence. Existing fixed-company quotes remain usable with the restored acceptance path. The disposable database runner executes this rollback before earlier marketplace rollbacks.
