# PWA ride payment recovery — 2026-10-23

Release: `2026.10.23-pwa-payment-recovery.1`.

The reported ended ride belonged to a different customer from the previously enabled Sandbox pilot. Its company was an eligible Leski direct city division, but that customer was absent from the explicit test allowlist. The published production entry and customer chunk already contained the prepared Stripe UI. The push-only service worker has no fetch handler or application-shell cache. There is no standalone-mode restriction on card payments.

Enabled only the customer identified by the reported ride for Sandbox testing, following the owner's existing phone-testing authorization. Verified an active CUSTOMER profile and the exact ride, Leski division and amount before the scoped allowlist upsert. The original pilot remains enabled; no other customers were enabled. Live merchant count remains zero. No ride, receipt, price, ledger entry or Stripe order was changed. The reported ride was subsequently settled in cash; test a new eligible ride rather than reopening a paid ride.

The payment panel now refreshes its existing user/ride-scoped state when a standalone app resumes via `pageshow`, and opts this query into stale refetch on foreground visibility. No additional timers, subscriptions or packages. Pending and failed checks no longer claim online payment is disabled or instruct a customer to pay cash before eligibility is known. Verified cash/card settlements display the recorded payment method rather than another request to pay; only server state determines settlement.

The world-scale map was an independent bounds-construction bug. Arbitrary pickup and destination coordinates were passed as the southwest and northeast corners of `LatLngBounds`. A westbound local trip therefore crossed the longitude wrap and covered almost the whole world. Build empty bounds and extend with both endpoints, start with a local center/zoom, and let recenter restore the route when live GPS is stopped or stale. No extra route or GPS requests.

## Validation

807 unit tests in 115 files pass, including regressions for four route directions without live GPS, recenter after arrival, loading/failure messages, recorded cash/card settlement and eligibility recovery without changing the ride. Lint, TypeScript and the build-configuration check pass. The existing 28 payment browser scenarios pass across Chromium/WebKit. Six additional scenarios exercise standalone signals, card fallback with no wallet, retained fields on resume, changed eligibility and slow state loading. Browser payment APIs are fixtures; these do not prove a physical iPhone installation, hardware Apple Pay approval or new Stripe settlement.

## Publication and phone check

Pull main into Readdy, publish and verify `/release.json` reports this release. Close and reopen the installed app without deleting it or resetting permissions. Use the authorized phone profile to request a new Leski ride. The card button is disabled during the trip and unlocks only after the driver ends it. Sandbox remains visibly marked and never records real revenue. Already paid rides cannot be paid again. No Stripe Dashboard, webhook, schema or permission changes are needed.

References: https://developers.google.com/maps/documentation/javascript/reference/coordinates#LatLngBounds (SW/NE constructor and `extend`), https://docs.stripe.com/elements/express-checkout-element (wallet availability and card alternative), https://developer.apple.com/videos/play/wwdc2023/10120/ (Home Screen app storage).
