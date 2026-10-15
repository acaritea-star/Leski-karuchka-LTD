-- Keep company ownership in the database, including direct Data API writes.
-- No customer, driver, ride, file or financial record is moved or deleted.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE OR REPLACE FUNCTION private.can_read_driver_document(p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid:=auth.uid(); owner_id uuid; document_id uuid;
BEGIN
 IF uid IS NULL OR p_name IS NULL OR p_name !~
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$'
 THEN RETURN false; END IF;
 owner_id:=split_part(p_name,'/',1)::uuid;
 document_id:=split_part(split_part(p_name,'/',2),'.',1)::uuid;
 -- Personal uploads remain recoverable before their registration is confirmed.
 IF owner_id=uid AND EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.user_id=uid AND p.role='DRIVER' AND p.is_active AND p.company_id=d.company_id)
 THEN RETURN true; END IF;
 -- A firm sees registered legacy documents belonging to its own driver only.
 -- Three-part application paths use application_file_access, with that
 -- application's own company and registered-file checks, never a user prefix.
 RETURN EXISTS(SELECT 1 FROM public.driver_documents x JOIN public.drivers d
  ON d.id=x.driver_id AND d.company_id=x.company_id
  WHERE x.id=document_id AND d.user_id=owner_id AND x.file_url='storage://driver-documents/'||p_name
   AND (public.is_company_admin(x.company_id) OR public.is_super_admin()));
END $fn$;
REVOKE ALL ON FUNCTION private.can_read_driver_document(text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.can_read_driver_document(text) TO authenticated;

CREATE OR REPLACE FUNCTION private.current_driver_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT d.id FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active AND p.company_id=d.company_id;
$fn$;
CREATE OR REPLACE FUNCTION public.is_driver(target_driver uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
  WHERE d.id=target_driver AND p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active
   AND p.company_id=d.company_id);
$fn$;

-- Notifications are produced by trusted workflows. The browser may mark its
-- own notification read, but cannot change its recipient, company or payload.
REVOKE INSERT,UPDATE,DELETE ON public.notifications FROM anon,authenticated;
GRANT UPDATE(is_read) ON public.notifications TO authenticated;
-- Financial postings use the validated, idempotent money operations.
REVOKE INSERT,UPDATE,DELETE ON public.payment_transactions,public.ledger FROM anon,authenticated;

-- Separate UUID foreign keys did not require both ends to have the same firm.
CREATE UNIQUE INDEX vehicle_types_id_company_uidx ON public.vehicle_types(id,company_id);
CREATE UNIQUE INDEX vehicles_id_company_uidx ON public.vehicles(id,company_id);
CREATE INDEX vehicles_category_company_idx ON public.vehicles(vehicle_type_id,company_id);
CREATE UNIQUE INDEX drivers_one_assigned_vehicle_idx ON public.drivers(vehicle_id,company_id);
ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_category_company_fkey
 FOREIGN KEY(vehicle_type_id,company_id) REFERENCES public.vehicle_types(id,company_id) ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_vehicle_company_fkey
 FOREIGN KEY(vehicle_id,company_id) REFERENCES public.vehicles(id,company_id) ON DELETE SET NULL(vehicle_id) NOT VALID;
ALTER TABLE public.vehicles VALIDATE CONSTRAINT vehicles_category_company_fkey;
ALTER TABLE public.drivers VALIDATE CONSTRAINT drivers_vehicle_company_fkey;
COMMIT;
