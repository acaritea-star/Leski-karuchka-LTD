-- Two-phase rollout: publish the enrollment UI before enabling the global gate.
-- No factors, sessions, profiles or historical application records are removed.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

CREATE TABLE private.app_security (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 staff_mfa_enforced boolean NOT NULL DEFAULT false,
 changed_at timestamptz NOT NULL DEFAULT statement_timestamp()
);
ALTER TABLE private.app_security ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.app_security FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON private.app_security TO service_role;
INSERT INTO private.app_security(singleton) VALUES(true);

CREATE FUNCTION private.staff_mfa_proof(p_user uuid,p_session text,p_aal text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT p_aal='aal2' AND EXISTS(
  SELECT 1 FROM auth.sessions s JOIN auth.mfa_factors f ON f.id=s.factor_id AND f.user_id=s.user_id
  WHERE s.user_id=p_user AND s.id::text=p_session AND s.aal::text='aal2' AND f.status::text='verified'
   AND (s.not_after IS NULL OR s.not_after>statement_timestamp())
 );
$fn$;
REVOKE ALL ON FUNCTION private.staff_mfa_proof(uuid,text,text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.staff_mfa_allowed()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid:=auth.uid(); role_name public.user_role; active boolean;
BEGIN
 IF NOT (SELECT staff_mfa_enforced FROM private.app_security WHERE singleton) OR uid IS NULL THEN RETURN true; END IF;
 SELECT p.role,p.is_active INTO role_name,active FROM public.profiles p WHERE p.id=uid;
 IF role_name IS NULL OR role_name='CUSTOMER' THEN RETURN true; END IF;
 RETURN active AND coalesce(private.staff_mfa_proof(uid,auth.jwt()->>'session_id',auth.jwt()->>'aal'),false);
END $fn$;
REVOKE ALL ON FUNCTION private.staff_mfa_allowed() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.staff_mfa_allowed() TO authenticated,service_role;

-- Pre-request covers invoker AND definer RPCs. RLS below also covers products
-- that do not run PostgREST hooks (Storage and Realtime).
CREATE FUNCTION private.require_staff_mfa()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 -- Own-profile bootstrap is read-only and still restricted to the own row by RLS.
 IF current_setting('request.path',true)='/profiles' AND current_setting('request.method',true) IN ('GET','HEAD') THEN RETURN; END IF;
 IF NOT private.staff_mfa_allowed() THEN
  RAISE EXCEPTION 'MFA_REQUIRED: complete two-factor authentication' USING ERRCODE='42501';
 END IF;
END $fn$;
REVOKE ALL ON FUNCTION private.require_staff_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.require_staff_mfa() TO anon,authenticated,service_role;

-- Do not silently replace another deployment's pre-request hook.
DO $guard$
DECLARE setting text;
BEGIN
 SELECT c INTO setting FROM pg_db_role_setting s CROSS JOIN LATERAL unnest(s.setconfig) c
 WHERE s.setrole=(SELECT oid FROM pg_roles WHERE rolname='authenticator') AND c LIKE 'pgrst.db_pre_request=%' LIMIT 1;
 IF setting IS NOT NULL AND setting NOT IN ('pgrst.db_pre_request=','pgrst.db_pre_request=private.require_staff_mfa') THEN
  RAISE EXCEPTION 'Existing pre-request hook must be composed before this migration';
 END IF;
END $guard$;
ALTER ROLE authenticator SET pgrst.db_pre_request='private.require_staff_mfa';
NOTIFY pgrst,'reload config';

DO $policies$
DECLARE t record;
BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE c.relkind IN ('r','p') AND c.relrowsecurity AND n.nspname='public' AND c.relname<>'profiles'
 LOOP
  EXECUTE format('CREATE POLICY staff_mfa_required ON %I.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT private.staff_mfa_allowed())) WITH CHECK ((SELECT private.staff_mfa_allowed()))',t.nspname,t.relname);
 END LOOP;
END $policies$;
CREATE POLICY staff_mfa_profile_read ON public.profiles AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT private.staff_mfa_allowed()) OR id=(SELECT auth.uid()));
CREATE POLICY staff_mfa_profile_insert ON public.profiles AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT private.staff_mfa_allowed()));
CREATE POLICY staff_mfa_profile_update ON public.profiles AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT private.staff_mfa_allowed())) WITH CHECK ((SELECT private.staff_mfa_allowed()));
CREATE POLICY staff_mfa_profile_delete ON public.profiles AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT private.staff_mfa_allowed()));
CREATE POLICY staff_mfa_required ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT private.staff_mfa_allowed())) WITH CHECK ((SELECT private.staff_mfa_allowed()));
CREATE POLICY staff_mfa_required ON realtime.messages AS RESTRICTIVE FOR ALL TO authenticated
 USING ((SELECT private.staff_mfa_allowed())) WITH CHECK ((SELECT private.staff_mfa_allowed()));

-- Preserve current authorization and firm boundaries, adding the second factor.
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.role='SUPER_ADMIN' AND p.is_active);
$fn$;
CREATE OR REPLACE FUNCTION public.is_company_admin(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.role='COMPANY_ADMIN' AND p.company_id=target_company AND p.is_active);
$fn$;
CREATE OR REPLACE FUNCTION public.is_driver(target_driver uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE d.id=target_driver AND p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active AND p.company_id=d.company_id);
$fn$;
CREATE OR REPLACE FUNCTION public.is_company_member(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.profiles p
 WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.company_id=target_company
 AND (p.role='COMPANY_ADMIN' OR (p.role='DRIVER' AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=p.id AND d.company_id=p.company_id))));
$fn$;
CREATE OR REPLACE FUNCTION public.is_driver_of_company(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.drivers d
 WHERE d.id=(SELECT private.current_driver_id()) AND d.company_id=target_company);
$fn$;

-- Edge Functions validate the bearer with GoTrue first and then call this
-- service-only API. Browser roles cannot supply their own assurance claims.
CREATE FUNCTION public.staff_mfa_edge_allowed(p_user uuid,p_session text,p_aal text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT NOT (SELECT staff_mfa_enforced FROM private.app_security WHERE singleton)
 OR EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.is_active AND
  (p.role='CUSTOMER' OR coalesce(private.staff_mfa_proof(p_user,p_session,p_aal),false)));
$fn$;
REVOKE ALL ON FUNCTION public.staff_mfa_edge_allowed(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_mfa_edge_allowed(uuid,text,text) TO service_role;
COMMIT;
