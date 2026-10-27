# Cash, terminal card and online payment choice

Customers of an online-enabled carrier could see only a card action, and drivers could lose both cash and terminal-card controls. Stripe sandbox eligibility was incorrectly used as a blanket ban on manual receipts. Hidden card prewarming also reserved a Checkout Session automatically when the trip ended, locking manual settlement even if the customer never selected card. Canceling that test Session did not release the database's test-environment guard.

## Result

- The customer has explicit online-card and cash choices after arrival. Choosing cash does not mark the ride paid: only the assigned driver confirms actual receipt. Driver controls distinguish cash, a physical POS terminal, and Stripe confirmation.
- Stripe SDK/frames can warm in advance, but the server Checkout Session starts only after an explicit card choice. Closing and reopening an existing card sheet reuses its Session. Cash-only rides do not create speculative Stripe orders.
- Active or uncertain online payments continue to block manual settlement. Cancellation expires and reconciles an existing Session; concurrent processing/payment never unlocks cash.
- A disconnected initialization can be canceled without initializing saved-card access for the driver. The service-only RPC locks the ride and order. It cancels only an Elements order with no bound Stripe Customer, no Session and no received funds. If Customer binding won the race, the normal Stripe expiry path is required.
- Only an explicitly confirmed manual receipt after all online orders have been canceled can settle real cash/POS. This is atomic with the environment change and the ledger entry. Paid or refunded test rides are not converted to real money.
- A delayed expiry of an older canceled order cannot overwrite a newer active payment, including a later live attempt. Duplicate events, exact amount/account/session/customer/driver binding, and monotonic refunds remain protected.
- A failed payment-state check exposes retry, not collection controls. Pending manual writes retain the original operation identity for reconciliation/retry. Realtime refreshes only the mounted checkout; terminal/ineligible payment polling stops.
- The separate test total is removed from both driver-wallet views. Existing test history and its API fields remain compatible with older clients and excluded from real totals. Individual sandbox receipts are still explicitly labeled. Mobile wallet spacing is retained. A POS receipt is no longer labeled cash on the customer request summary.

## Verification

Source: `ddfce61b96af7cea5ac6aedd2363c65c79da90b5`.

- 852 unit tests, lint, TypeScript/Vite build, production dependency audit, and Edge Function type checks passed.
- 279 mobile Chromium/WebKit tests passed; one existing WebKit background-service-worker case remains skipped. Coverage includes 320px payment choices, PWA resume, card/wallet entry, no automatic Session, driver cash/POS, lost responses, receipt isolation and wallet reload. Screenshots were inspected. Google Maps calls are blocked by the browser fixtures; fixture map-error placeholders are expected.
- The disposable database suite passed, including actual concurrent cash-vs-online reservation and cancellation-vs-Customer-binding races, receipt idempotency, partial/unpaid handling, company/customer isolation, staff MFA and old-test/new-live expiry ordering. No production customer data was used for synthetic writes.
- [Application checks](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/40476647153) and [database checks](https://github.com/acaritea-star/Leski-karuchka-LTD/actions/runs/40476647207).
- Migration `20261026195021_restore_cash_payment_choice.sql` was deployed as `20261027084819`. `ride-checkout` is active at version 10; its own authentication remains enabled. Anonymous HTTP invocation returned 401. The new RPC is denied to anonymous/authenticated browser roles and granted only to the server role. Security/performance advisor findings did not increase.
- The main JS entry remains 392,674 bytes. No dependency or Realtime channel was added. All 21,870 relative asset references across the retained deployment bundles resolve. Older hashed assets are retained for open PWA sessions.

## Launch boundary

The app's merchant configuration was checked and still has `livemode=false`. This release does not switch Stripe live, change keys, move funds, or relabel test payments as real. Live-account keys, matching publishable key and webhook configuration, payment-domain/wallet readiness, and an authorized real-phone payment/refund/driver-receipt check remain a separate release step. Legal launch approval remains false; these technical checks do not establish legal approval or prove the entire app has no bugs.
