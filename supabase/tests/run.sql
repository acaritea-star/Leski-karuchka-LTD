\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
\ir core.sql
SAVEPOINT regression_suite;
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
ROLLBACK;
-- Independent suites own their rollback-only transactions.
\ir driver_verification.sql
\ir pwa_accounting_legal.sql
\ir audit_lifecycle.sql
\ir bulgaria_service_area.sql
\ir admin_access.sql
