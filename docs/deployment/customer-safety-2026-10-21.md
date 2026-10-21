# Customer emergency access

The customer's 112 control previously occupied the same header as the menu
and notifications. It now has a separate shield chip labelled “Сигурност | 112”.
On booking/tracking maps it sits at the lower left, clear of map attribution,
zoom controls, the header and the booking sheet. On desktop it sits beside the
sheet. A short keyboard viewport keeps one chip in a compact map strip, without
adding another row to the sheet; the header collapses until the keyboard closes. Secondary customer
screens have a bottom-left dock, reserved scrolling space and keyboard-aware
positioning. Loading/error screens also retain emergency access.

The first-run welcome explains the new position in Bulgarian and English. Its
existing once-per-customer claim is unchanged. Opening the chip still shows an
explicit `tel:112` action in the existing native dialog; it never places a call
on the first tap, requires GPS, or sends a location/alert to the emergency service.
Tests only inspect the link; they never activate a dialer.

## Verification

- Frontend TypeScript and lint passed.
- Existing emergency and first-run unit tests passed.
- 20 focused Chromium scenarios passed, including the new safety checks,
  first-run welcome, staff MFA, offline profile recovery, company offers and
  the short-keyboard company list. A shield remains reachable while ride
  history is unavailable.
- Verified non-overlap, 44px targets, focus restoration and clickable menu/bell
  at 320×568, 390×844, 844×390 and 1280×800. Inspected mobile and keyboard screenshots.
- GitHub CI runs the complete unit/browser suites with Chromium and WebKit.

## Publishing

The repository's packaged `out` must be refreshed from the verified source
and preserve previously published hashed assets for already open clients.
The source and packaged release are then pushed to `main`. Public hosting uses
Readdy's **Pull from GitHub → Publish**. A main push alone does not publish it.
Before this change, the public release was `2026.10.20-launch-audit.1`.

## Payment status

This change does not introduce a customer Stripe Checkout or mark any driver's
ride paid. The Stripe sandbox backend was deployed separately; customer payment,
driver confirmation and online accounting still need product integration and a
completed signed sandbox payment test. Selecting an online method must never be
presented as “Платено онлайн”. One legal Leski company uses one merchant account;
city divisions keep separate operating scopes. Future independent firms use Connect.
