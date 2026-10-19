# Customer notification and PWA audit — 19 October 2026

The inbox is isolated by authenticated user and role. The private Broadcast topic is
`inbox:<auth.uid()>:customer`; it contains a hint, while authenticated inbox
RPCs load the content. Clients cannot select a push recipient or write notification
content. The delivery worker resolves active subscriptions by the queued recipient.

Production audit found zero notification/outbox recipient mismatches, zero customer
ride-owner mismatches and zero endpoints with multiple active account owners. These
checks describe stored data at audit time; they are not proof of end-device delivery.
The preceding seven days also contained eight skipped customer jobs with
`NO_SUBSCRIPTION`: those recipients had no active registered delivery endpoint.
One customer Apple endpoint was registered as active at audit time; an active
database row does not prove that endpoint still reaches a physical device.

## Changes

- Persist only the active account UUID in a dedicated Cache Storage entry shared by
  the app and worker. No JWT, profile, route, receipt or response caching.
- Reject wrong-account, missing-recipient and expired pushes, including customer
  status messages. Recheck account ownership when a notice is tapped.
- Clear old displayed system notices on account change/logout and worker activation.
  External Auth logout and profile deactivation also clear the worker boundary.
- Inspect the browser subscription on foreground/online/pageshow. Repair missing or
  changed subscriptions silently when permission is already granted. Coalesce
  concurrent registration and avoid repeating a healthy server write within five
  minutes. No new interval, dependency or Realtime channel.
- Revalidate outbox payload, notification and request customer ownership when claiming
  a delivery job. Preserve existing single-use leases, expiry and role checks.
- Replace incorrect non-square external manifest icons and missing push image paths
  with local PNGs exported from small code-native SVG cart marks.
- Show the existing Home Screen guidance instead of calling unsupported iPhone push
  a blocked permission. Browser permission is requested only by the enable button.

## Customer events

| Event | Inbox | Background push |
| --- | --- | --- |
| Driver accepts | Yes | Yes, if still current and unread |
| Driver arrives | Yes | Yes, urgent |
| Trip starts | Yes | No, silent |
| Trip completes | Yes | Yes, opens rating |
| Driver/system cancels, no driver | Yes | Yes, if still current |
| Customer cancels their own ride | Yes | No |

Delivery is at least once. Tags replace repeated notices and renotify is disabled.
Reading a notice or a later ride state can make a queued push obsolete; skipping it
is expected. Browser provider acceptance does not prove a person saw the notice.

## PWA limits and verification

Home Screen installation is required for Web Push on iOS/iPadOS 16.4+. HTTPS,
browser/OS notification permission and connectivity are required. Focus modes,
revoked permissions, uninstalling the PWA or OS restrictions can prevent delivery.
The worker starts on demand; the app does not offer offline booking.

Sources: WebKit, “Web Push for Web Apps on iOS and iPadOS”;
MDN Push API and ServiceWorkerGlobalScope.pushsubscriptionchange.
The latter event is not supported everywhere, so resume checks are retained.

Automated tests cover two distinct customers, RLS, private channels, mark-read/open,
shared endpoint ownership, malformed queued recipients, worker restarts, stale pushes,
old notice clicks, external logout, opt-out and silent subscription repair. Native
Supabase CI is authoritative for RLS/Broadcast. Browser fixtures do not send real push.
A physical iPhone and Android delivery check remains necessary after frontend publish.

## Release verification

Native Supabase regression passed for the unchanged migration SQL, including the
two-customer isolation suite and existing concurrent booking/payment and MFA tests.
Production migration version is `20261019174904`; only its filename was aligned with
the MCP-assigned version. Local unit coverage passed (668 tests before the final
external-logout case; all 51 focused tests including that case passed). Source
`6c4e228d5d6370453f7040a34aa7421f4178ca61` is the reference for final GitHub Check/browser results.
Frontend publication is separate from database application and the GitHub package.

After publishing the frontend, open existing installed PWAs once to initialize the
new account boundary and renew their device registration. Saved browser permission
is retained. Until that first open, the updated worker intentionally suppresses
notifications whose active account is unknown. Then test a real accepted/arrived
ride with the PWA closed on iPhone and Android, and repeat after switching accounts.
