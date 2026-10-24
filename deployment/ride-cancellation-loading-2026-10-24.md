# Ride cancellation and loading, 24 October 2026

## Problems and changes

- Customer orders exposed only tracking. Pending, accepted and arrived rides now have a direct cancellation action and a confirmation dialog. The existing ownership/transition guarded server operation remains authoritative. No cancellation is offered after the driver starts the trip.
- Tracking's fixed-height map sheet could clip cancellation behind its non-shrinking payment footer. Contact/cancellation now occupy a reserved row, while trip details scroll. After arrival, payment moves to the start of the content and receives more vertical space. The map retry state reserves space for the safety action.
- Rapid cancellation taps share a synchronous write latch. The existing operation reconciles an ambiguous response; success uses the persisted server receipt. The order cache is updated without a second list request. Account/ride changes discard stale component completions.
- Scoped company pages previously mounted before the company query resolved, then remounted on the first company ID. This could reset a tab selected during startup and caused an intermittent driver-review browser failure. AuthGuard now waits for the initial company scope; deliberate company switches still clear company-specific forms.
- A shared loading component replaces standalone large spinners across customer orders, driver screens, company lists/reports and news. Order headers stay usable during reads; public navigation stays outside the route Suspense boundary. Motion is restrained and disabled by reduced-motion preference.
- A small inline boot template replaces the blank root while the entry module loads. The existing non-JavaScript document remains intact.
- Route code starts loading on navigation intent (pointer/focus) and for the current route, avoiding the notification-provider waterfall. Intent preloading is suppressed on Save-Data/2G connections. This fetches code only, not account records, and adds no dependency or API polling.

## Validation and deployment limits

- Local lint, typecheck, production build and 824 unit tests pass.
- Browser coverage includes the cancellation statuses, duplicate taps, lost write response, an ongoing ride, short-phone tracking, delayed order reads, reduced motion, code-only preloading, and an entry-module delay. Existing payment-confirmation, company-review and role-screen regressions are included in the release checks.
- No schema, RLS, Stripe secrets, payment mode or hosting settings changed. Stripe remains in test mode.
- Public hosting is separate from GitHub source publication. The repository has no configured deployment workflow; Readdy access was reported unavailable. A main commit alone is not proof that the public site serves this release.
- Browser transport/API fixtures are synthetic. A physical-phone check after publication remains necessary; no phone speed SLA is claimed.
