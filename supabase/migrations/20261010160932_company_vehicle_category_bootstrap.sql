BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE public.companies,public.vehicle_types IN SHARE ROW EXCLUSIVE MODE;

-- The company and its usable base category are created in the same transaction.
-- A multiplier of one preserves the company's own tariff exactly.
CREATE FUNCTION private.seed_company_vehicle_type() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 INSERT INTO public.vehicle_types(company_id,name,capacity,multiplier,is_active)
 SELECT NEW.id,'Стандарт',4,1.00,true
 WHERE NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE company_id=NEW.id);
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.seed_company_vehicle_type() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER seed_company_vehicle_type
AFTER INSERT ON public.companies FOR EACH ROW
EXECUTE FUNCTION private.seed_company_vehicle_type();

-- Repair only companies that have no categories at all. Existing tariffs,
-- category IDs/multipliers and intentionally disabled categories stay intact.
INSERT INTO public.vehicle_types(company_id,name,capacity,multiplier,is_active)
SELECT c.id,'Стандарт',4,1.00,true FROM public.companies c
WHERE NOT EXISTS(SELECT 1 FROM public.vehicle_types t WHERE t.company_id=c.id)
ON CONFLICT(company_id,name) DO NOTHING;
COMMIT;
