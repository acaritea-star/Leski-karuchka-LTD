-- Managed PostGIS objects are owned by supabase_admin. postgres has TRIGGER
-- permission, not ownership; enforce read-only client access without changing
-- the extension owner, schema, grants or projection definitions.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE FUNCTION private.guard_geographic_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $guard$
BEGIN
 IF current_user IN ('anon','authenticated') THEN
  RAISE EXCEPTION 'Geographic reference data is read-only for application clients' USING ERRCODE='42501';
 END IF;
 RETURN NULL;
END $guard$;
REVOKE ALL ON FUNCTION private.guard_geographic_reference() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER client_geographic_reference_read_only
 BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON public.spatial_ref_sys
 FOR EACH STATEMENT EXECUTE FUNCTION private.guard_geographic_reference();
COMMIT;
