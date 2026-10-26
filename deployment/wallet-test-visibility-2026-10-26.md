# Test payment visibility and mobile wallet dialog

The reported EUR 2.97 payment was confirmed on 26 October at 10:51 Europe/Sofia. The stored ride is completed, paid online and marked TEST. Its registered Stripe order has amount and received both 297 cents, no refund, and two signed event records. No real ledger entry exists, as intended for test payments.

The previous wallet only displayed real collected money. Its transient test receipt disappeared after navigation/reload, leaving zero without an immediately visible test result. The wallet dialog also had no inner padding because the shared Modal intentionally leaves spacing to its children.

## Changes

- The existing daily aggregate now returns a separate test-payments total and count. Only completed, paid online TEST rides with a positive final price and paid online state qualify. Real money still uses the receipt ledger and is unchanged.
- Tests with partial or full refunds are excluded from the successful test total and counted separately. The UI explicitly explains their exclusion; it does not invent a net test amount from the original fare.
- Both driver panels show the separate test total, including after a full reload. No local balance increment, additional request, polling loop or Realtime channel is introduced.
- The same driver/day scope, SECURITY INVOKER, tenant/MFA guards, RLS and grants remain. A single bounded driver/date ride scan serves both aggregates. No private Stripe table is exposed.
- The wallet dialog now has 18–24px inner padding, a 440px maximum width, a distinct real total, a separate test panel, readable spacing and 44px controls. Shared modal focus/scroll/safe-area handling is retained.

## Validation

Regression coverage includes independent real/test totals, reload persistence, one refresh after settlement, duplicate events, invalid aggregate rejection, refunds, Sofia day boundaries, and existing driver/company/customer/anonymous scope checks. Browser tests assert dialog insets and overflow at 390px and 320px, and exercise refresh, close and focus restoration.

Stripe remains in TEST mode. This change neither charges money nor enables Google Pay or live payments.

Final source checks: 835 unit tests and 275 browser tests passed; one existing WebKit background-service-worker case is skipped. Check run 40332266950 and database run 40332267023 succeeded for source 9921e5b51979a972cefcead0f9b8794411cd0663. The production migration is recorded as 20261026134209, with SECURITY INVOKER and original grants preserved. The reported driver/day returns a separate test total of 2.97 and one successful test. Security and performance advisor findings are unchanged.

The production build resolves all 766 checked JS/CSS references; the main entry remains 392,674 bytes. Existing hashed assets are retained for open PWA tabs.
