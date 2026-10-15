-- Emergency security rollback. Disposable CI executes this file only on localhost.
-- Restores previous permissions and file access; prefer a forward fix in production.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.drivers DROP CONSTRAINT drivers_vehicle_company_fkey;
ALTER TABLE public.vehicles DROP CONSTRAINT vehicles_category_company_fkey;
DROP INDEX public.drivers_one_assigned_vehicle_idx;
DROP INDEX public.vehicles_category_company_idx;
DROP INDEX public.vehicles_id_company_uidx;
DROP INDEX public.vehicle_types_id_company_uidx;
CREATE OR REPLACE FUNCTION private.can_read_driver_document(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE d.user_id::text=split_part(p_name,'/',1)
 AND ((d.user_id=auth.uid() AND p.is_active AND p.role='DRIVER') OR public.is_company_admin(d.company_id) OR public.is_super_admin()));
$function$;

CREATE OR REPLACE FUNCTION private.current_driver_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d.id FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active;
$function$;

CREATE OR REPLACE FUNCTION public.is_driver(target_driver uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.drivers d
    JOIN public.profiles p ON p.id = d.user_id
    WHERE d.id = target_driver AND p.id = auth.uid() AND p.role = 'DRIVER' AND p.is_active = true
  );
$function$;

REVOKE UPDATE(is_read) ON public.notifications FROM authenticated;
GRANT INSERT,UPDATE,DELETE ON public.notifications,public.payment_transactions,public.ledger TO authenticated;
COMMIT;

