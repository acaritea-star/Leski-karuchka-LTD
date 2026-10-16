BEGIN;
CREATE FUNCTION public.staff_mfa_pre_request()
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 -- Anonymous public reads need no access to the private schema.
 -- Authenticated staff still execute the full live-role/session/factor gate.
 IF auth.uid() IS NOT NULL THEN PERFORM private.require_staff_mfa(); END IF;
END $fn$;
REVOKE ALL ON FUNCTION public.staff_mfa_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_mfa_pre_request() TO anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION private.require_staff_mfa() FROM anon;
ALTER ROLE authenticator SET pgrst.db_pre_request='public.staff_mfa_pre_request';
NOTIFY pgrst,'reload config';
COMMIT;
