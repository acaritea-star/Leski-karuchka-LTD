# Live ride payments — 27 October 2026

Release: `2026.10.27-live-payments.1`. Verified application source: `d1800610b3b473c639934517211f2371e86c2fc4`.

## Customer and driver behavior

- Live online payments are enabled for the Leski Karuchka merchant root and its eligible city branches. Other companies remain outside this merchant's payment scope.
- Customer payment controls say “Плати онлайн с карта”, without sandbox banners or test instructions. Card entry remains available alongside eligible device wallets.
- Sandbox records are archived from customer/driver collection controls and excluded from visible real-money history, wallet totals and receipt animations. Historical data is preserved; no sandbox amount is converted into real money.
- The driver still relies on server-verified settlement, rather than a browser success screen, for “Платено онлайн” and wallet credit. Cash and terminal collection remain separate supported paths.
- No new dependencies, payment polling loops or Realtime channels were introduced.

## Production configuration and server checks

- The intended Stripe merchant is in live mode. The supplied live publishable key is stored in the merchant configuration, not hardcoded into frontend modules.
- Deployed `ride-checkout` and `stripe-webhook`: version 16. The credential resolver supports the existing `STRIPE_API_KEY` / `STRIPE_WEBHOOK_API` secret names while keeping test and live credentials bound to their own environment. Explicit environment-specific values take precedence.
- Live readiness GET returns `{"ready":true}` after verifying the server key's account and charge capability and checking that a signing secret is configured. Its response contains no credentials, account IDs or ride data. Successful results are cached for 60 seconds per warm instance.
- Anonymous checkout mutation returns HTTP 401. The health route does not bypass mutation authorization, company scope or staff MFA.
- The live Stripe webhook is enabled with 12 checkout, PaymentIntent and refund event types. Signature, account, environment, amount, currency, ride ownership and duplicate-settlement checks remain in place.
- The `leskikaruchka.com` live payment-method domain is registered; Apple Pay and Google Pay domain validations are active. **Google Pay remains disabled in the account's default payment-method configuration.** Domain registration alone does not enable that payment method. Android customers can use the card form.

## Validation

- 863 unit tests passed across 121 files. Lint, application type checks and production build passed.
- GitHub Edge Function type check passed against the verified source.
- Full database regression passed: [run 40543114258](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/40543114258), including tenant isolation, payment settlement, concurrency, MFA and legal acceptance cases.
- Initial browser run: 275 passed, two stale legal-version fixture assertions failed, one skipped. The fixture now imports the canonical version. Final browser verification is pending; [run 40543114282](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/40543114282) stalled while installing Playwright's browsers before executing scenarios.
- Current generated frontend JavaScript contains no old test-payment labels or testing-period sentence. Entry bundle: `index-L2PUVZIU.js`, 392,583 bytes (previously 392,674). Prior hashed assets are retained for already-open PWA sessions; 22,421 relative JS/CSS references were checked, with none missing.
- Supabase security/performance advisor findings are unchanged from the existing baseline; this release does not claim those pre-existing findings are resolved.

## Legal source versioning and retained history

The obsolete testing-period sentence was removed and the terms source version advanced to `2026-10-27-draft.4`; privacy remains `2026-10-08.1`. Migration `20261027161923_live_service_terms_status.sql` was applied to production as version `20261027164539`. Previous consent receipts are retained; cached clients have seven days to submit the predecessor version, without representing that receipt as acceptance of the new version. Legal identity/approval flags were not changed by this technical release.

## Remaining evidence limits

No real customer charge or refund was initiated for this release. No live paid ride is yet available as evidence of the entire signed-webhook → driver-wallet path. The readiness probe verifies credentials and charge capability; it does not prove that the configured signing secret matches a delivered live event. A real ride payment on a physical phone, followed by the corresponding Stripe event, order settlement and single driver-wallet credit, remains the final production observation. Physical Apple Pay/PWA behavior also depends on the customer's eligible device and wallet.
