# UI resilience, 24 October 2026

## Changes

- Failed order reads keep the header, navigation and emergency action accessible. Retry stays in context, cached orders remain visible after a failed refresh, and internal server errors are replaced with localized, actionable messages.
- Customer menus track the visual viewport so the close and logout controls remain reachable above a software keyboard. The middle navigation area scrolls independently. Focus returns to the menu trigger after closing.
- Closing timers are cancelled on navigation, reopening and unmount. A late animation timer can no longer dismiss a newly opened menu. Vertical or diagonal scrolling does not trigger the horizontal swipe-to-close gesture. Reduced-motion preferences skip the closing delay.
- Customer menus, company sidebars and shared dialogs use one reference-counted scroll lock. Closing one overlay cannot release another overlay's lock, and a closed menu does not overwrite the page's original overflow style.
- Critical customer navigation, address search, tracking controls and public mobile-menu controls use small inline SVG icons. These controls remain visible when the optional external icon font fails. No dependency, API request or polling was added.

## Validation

- Lint, TypeScript, production build and 827 unit tests pass locally, including menu timer, swipe and overlapping-dialog regressions.
- 30 selected WebKit browser scenarios pass: role-screen layouts, customer safety, settings/profile failures, nested dialogs, payment fields and bank-authentication focus, and the new viewport/icon/order-error cases. One new selector initially matched both an empty-state title and the page heading; it was made exact and all three new cases were rerun successfully.
- Browser API and payment fixtures are synthetic. No real ride, charge, webhook or customer data was changed by these tests. Physical-phone keyboard and PWA checks are still needed after publication.
- GitHub Actions runs the full browser suite with Chromium and WebKit on the source/release commits. Consult the actual run result, rather than treating this document as proof of that run's completion.

## Publication

This update changes UI source and its packaged frontend only. Stripe remains in test mode. Database authorization, company scope, payment settlement and webhook logic are unchanged. Historical hashed frontend assets are retained for existing PWA sessions.

Publishing to main does not prove deployment to public hosting. The repository has no configured hosting deployment workflow, and Readdy access was reported unavailable.
