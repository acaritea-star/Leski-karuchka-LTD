# Compact booking UI, 25 October 2026

The company selector now separates the carrier, exact price and selection more clearly without expanding the map sheet. A selected carrier shows its category and capacity. The details view exposes the full carrier name and exact amount, including when a long name is shortened in the compact list.

The booking action no longer labels every offer as cash-only. Details explain that payment follows the trip; the existing ride-payment eligibility and server-confirmation flow still decide which payment methods are actually available. No payment, quote, dispatch or company-authorization contract changed.

Address controls render visibly from their first frame. The short entrance motion only moves them slightly instead of beginning with a blank panel. Enabled/disabled primary-action colors change together immediately, avoiding a white label on the previous pale background. Quote loading uses placeholders matching the compact offer rows.

Critical status and booking icons use inline SVG. Platform logos retain their original image and fall back to the bundled PWA mark if its external host fails. The fallback is shared across customer, driver, company and public navigation/authentication screens without adding a package.

On short portrait screens, the failed-map message and retry action now occupy the gap between route controls and emergency help. The redundant map failure message is hidden when the offline notice already occupies that space; the order flow stays available.

## Validation

- Regression coverage includes 320 px screens, long carrier names, three-digit prices, exact carrier selection, expired/unavailable offers, search, keyboard viewports, route reuse, and recovery from unavailable external assets.
- Existing cancellation, customer safety, role-screen, form failure and inline-payment tests cover the shared components.
- Lint, TypeScript, unit tests and production builds run through `npm run check`; GitHub Actions also runs the complete Chromium/WebKit suite. Check the actual workflow conclusion for the published commit.
- Browser tests use synthetic transport/payment data and block paid external API traffic. Screenshots showing an unavailable map deliberately exercise its recovery state. They do not establish physical-phone latency or real payment settlement.

## Publication boundaries

No dependencies, additional application API calls, schema changes, payment keys or payment-mode changes are introduced. Stripe remains in test mode. The packaged release retains historical hashed assets for existing PWA sessions. GitHub publication and public hosting deployment remain separate; this repository has no hosting deployment workflow.
