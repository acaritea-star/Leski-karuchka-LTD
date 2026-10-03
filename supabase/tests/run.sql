\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
\ir core.sql
\ir nearby_cars.sql
\ir quote_service_role.sql
\ir request_accounting.sql
\ir cash_geo_push.sql
\ir reliable_dispatch.sql
\ir competing_acceptance.sql
ROLLBACK;
