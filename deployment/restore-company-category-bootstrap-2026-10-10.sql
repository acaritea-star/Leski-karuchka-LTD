-- Disable the bootstrap only; retain categories that may already be used by
-- vehicles, quotes or historical rides. Run via a reviewed rollback migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DROP TRIGGER IF EXISTS seed_company_vehicle_type ON public.companies;
DROP FUNCTION IF EXISTS private.seed_company_vehicle_type();
COMMIT;
