\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
\ir core.sql
SAVEPOINT regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir booking_availability.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir scale_security.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir nearby_cars.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir quote_service_role.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir request_accounting.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
-- These three suites intentionally share a dispatch scenario.
\ir cash_geo_push.sql
\ir reliable_dispatch.sql
\ir competing_acceptance.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir route_budget.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir server_summaries.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir admin_read_models.sql
ROLLBACK TO regression_suite;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
\ir ride_evidence.sql
ROLLBACK;
-- Independent suites own their rollback-only transactions.
\ir driver_verification.sql
\ir driver_preparation.sql
\ir driver_preparation_version_history.sql
\ir unified_driver_onboarding.sql
\ir pwa_accounting_legal.sql
\ir audit_lifecycle.sql
\ir bulgaria_service_area.sql
\ir admin_access.sql
\ir p1_api_permissions.sql

\ir financial_integrity.sql
\ir company_vehicle_category.sql

\ir partner_invitations.sql
\ir tenant_reliability.sql
\ir reverse_workflows.sql
\ir marketplace_dispatch.sql

\ir carrier_choice.sql

\ir idle_location_validity.sql

\ir carrier_offer_availability.sql

\ir company_driver_isolation.sql
\ir company_driver_performance.sql
\ir role_notifications.sql
\ir customer_notifications.sql
\ir customer_first_welcome.sql

\ir ride_payment_receipts.sql

\ir open_driver_applications.sql

\ir city_company_divisions.sql

\ir staff_mfa.sql

\ir launch_api_hardening.sql

\ir stripe_sandbox_receipts.sql

\ir post_trip_stripe_payments.sql


\ir test_ride_checkouts.sql
\ir inline_ride_checkout.sql
\ir cash_payment_choice.sql
\ir live_service_terms_status.sql
\ir geographic_reference.sql
