# In-app Stripe test payments

The driver ends the trip and freezes its agreed fare. An explicitly allowlisted customer of the Leski root or a direct city division can then open hosted Stripe Checkout on their phone. Test mode is shown in both panels. Other customers and companies cannot obtain test checkout eligibility.

`STRIPE_API_KEY` and `STRIPE_WEBHOOK_API` contain the matching test API key and signing secret. The API key must belong to one of the two existing Leski test environments. The enabled private merchant must match that verified account. Live mode remains disabled and uses separate live secrets.

Apply the allowlisted-test migration only after the disposable database regression passes. Deploy `stripe-webhook` and `ride-checkout` from the same source. Configure the private merchant and the customer allowlist separately; the migration seeds neither production identities nor activation flags. Publish the frontend with the visible test labels.

Only a signature-verified event followed by Stripe API reconciliation, or authenticated server reconciliation of that same Checkout, can confirm payment. Session, intent, fare, request, customer, company, account and mode bindings are checked. Event retries are idempotent. A redirect cannot mark a trip paid.

Simulated completion is stored with `payment_environment='test'`. It creates no payment transaction, driver cash income, request outcome or public trip. Driver earnings, trip counters, company revenue and accounting reports exclude it. Canceling Checkout does not permit converting a test ride into a real cash receipt.

To stop new tests, disable the test merchant and its customer allowlist. Keep the matching API key and webhook active until any open Checkout has expired or been reconciled. Do not change an existing order's mode, clear a test flag, or manually fabricate payment confirmation. Live activation is a separate release after genuine merchant readiness and live webhook verification.

Validation includes the full application check, mode-binding unit tests, rollback SQL tests for tenant/customer isolation and zero finance postings, existing live-payment regression, and phone-sized browser tests for customer and driver updates.
