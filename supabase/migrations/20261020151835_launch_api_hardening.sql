-- Launch audit: protect extension reference data without dropping/recreating PostGIS.
-- On hosted Supabase spatial_ref_sys belongs to supabase_admin. postgres has
-- TRIGGER permission, but cannot enable RLS or revoke the owner's table grants.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION private.guard_spatial_reference_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF current_user NOT IN ('postgres','supabase_admin','service_role') THEN
  RAISE EXCEPTION 'Spatial reference data is read-only for application roles' USING ERRCODE='42501';
 END IF;
 RETURN NULL; -- Statement triggers ignore the return value.
END $fn$;
REVOKE ALL ON FUNCTION private.guard_spatial_reference_writes() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER leski_spatial_reference_write_guard
BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.spatial_ref_sys
FOR EACH STATEMENT EXECUTE FUNCTION private.guard_spatial_reference_writes();

-- The caller identity and global role/MFA checks are constant within a query.
-- Keep company-dependent checks correlated; preserve parent/child isolation.
ALTER POLICY invitation_admin_read ON public.partner_invitations USING(
 (SELECT public.is_super_admin()) OR (kind='driver' AND public.is_company_admin(company_id))
 OR (kind='company' AND (SELECT private.staff_mfa_allowed()) AND EXISTS(
  SELECT 1 FROM public.companies child JOIN public.profiles actor ON actor.company_id=child.parent_company_id
  WHERE child.id=partner_invitations.company_id AND actor.id=(SELECT auth.uid()) AND actor.role='COMPANY_ADMIN' AND actor.is_active)));
COMMIT;
