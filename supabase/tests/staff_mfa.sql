-- Synthetic, rollback-only. No real account, factor secret or session is used.
BEGIN;
SET LOCAL statement_timeout='45s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE FUNCTION pg_temp.mfa_denied(q text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL MFA gate allowed: %',q;
END $fn$;
DO $test$
DECLARE ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); root uuid:=gen_random_uuid(); adm uuid:=gen_random_uuid();
 drv uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); uid uuid; sid uuid; fid uuid; did uuid; n integer;
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(ca,'MFA firm','mfa-'||ca),(cb,'MFA foreign','mfa-'||cb);
 INSERT INTO auth.users(id,email) SELECT u,'mfa-'||u||'@example.invalid' FROM unnest(ARRAY[root,adm,drv,customer]) x(u);
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=root;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=ca WHERE id=adm;
 UPDATE public.profiles SET role='DRIVER',company_id=ca WHERE id=drv;
 SELECT id INTO did FROM public.drivers WHERE user_id=drv;
 UPDATE private.app_security SET staff_mfa_enforced=true;
 FOREACH uid IN ARRAY ARRAY[root,adm,drv] LOOP
  sid:=gen_random_uuid(); fid:=gen_random_uuid();
  INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at) VALUES(fid,uid,'totp','unverified',now(),now());
  INSERT INTO auth.sessions(id,user_id,factor_id,aal,created_at,updated_at) VALUES(sid,uid,fid,'aal2',now(),now());
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal','aal1','session_id',sid,'user_metadata',jsonb_build_object('role','CUSTOMER','aal','aal2'))::text,true);
  SET LOCAL ROLE authenticated;
  IF private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL staff aal1 accepted'; END IF;
  PERFORM set_config('request.path','/rpc/accounting_report',true); PERFORM set_config('request.method','POST',true);
  PERFORM pg_temp.mfa_denied('SELECT private.require_staff_mfa()');
  PERFORM pg_temp.mfa_denied(format('SELECT public.accounting_report(current_date,current_date+1,%L::uuid)',ca));
  IF public.is_super_admin() OR public.is_company_admin(ca) OR public.is_driver(did) THEN RAISE EXCEPTION 'FAIL role predicate bypassed MFA'; END IF;
  SELECT count(*) INTO n FROM public.profiles; IF n<>1 THEN RAISE EXCEPTION 'FAIL bootstrap exposed % profiles',n; END IF;
  SELECT count(*) INTO n FROM public.drivers; IF n<>0 THEN RAISE EXCEPTION 'FAIL raw driver data exposed'; END IF;
  SELECT count(*) INTO n FROM public.driver_money_entries; IF n<>0 THEN RAISE EXCEPTION 'FAIL raw financial data exposed'; END IF;
  SELECT count(*) INTO n FROM storage.objects; IF n<>0 THEN RAISE EXCEPTION 'FAIL files exposed'; END IF;
  PERFORM set_config('request.path','/profiles',true); PERFORM set_config('request.method','GET',true);
  PERFORM private.require_staff_mfa();
  PERFORM set_config('request.method','PATCH',true); PERFORM pg_temp.mfa_denied('SELECT private.require_staff_mfa()');
  RESET ROLE;
  -- aal2 text alone is not proof: the factor must be verified and linked to this live session.
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',uid,'role','authenticated','aal','aal2','session_id',sid)::text,true);
  SET LOCAL ROLE authenticated;
  IF private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL unverified factor accepted'; END IF;
  RESET ROLE;
  UPDATE auth.mfa_factors SET status='verified' WHERE id=fid;
  IF public.staff_mfa_edge_allowed(uid,sid::text,'aal1') OR NOT public.staff_mfa_edge_allowed(uid,sid::text,'aal2') THEN RAISE EXCEPTION 'FAIL Edge assurance check'; END IF;
  SET LOCAL ROLE authenticated;
  IF NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL verified staff rejected'; END IF;
  PERFORM set_config('request.path','/rpc/accounting_report',true); PERFORM set_config('request.method','POST',true);
  PERFORM private.require_staff_mfa();
  IF uid=root AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'FAIL super admin denied'; END IF;
  IF uid=adm AND (NOT public.is_company_admin(ca) OR public.is_company_admin(cb)) THEN RAISE EXCEPTION 'FAIL company scope changed'; END IF;
  IF uid=drv AND NOT public.is_driver(did) THEN RAISE EXCEPTION 'FAIL driver denied'; END IF;
  RESET ROLE;
  UPDATE auth.sessions SET aal='aal1' WHERE id=sid;
  IF public.staff_mfa_edge_allowed(uid,sid::text,'aal2') THEN RAISE EXCEPTION 'FAIL Edge accepted downgraded session'; END IF;
  SET LOCAL ROLE authenticated;
  IF private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL downgraded session with old aal2 JWT accepted'; END IF;
  RESET ROLE;
  UPDATE auth.sessions SET aal='aal2' WHERE id=sid;
  UPDATE auth.mfa_factors SET status='unverified' WHERE id=fid;
  IF public.staff_mfa_edge_allowed(uid,sid::text,'aal2') THEN RAISE EXCEPTION 'FAIL Edge accepted unverified factor'; END IF;
  SET LOCAL ROLE authenticated;
  IF private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL removed verification accepted'; END IF;
  RESET ROLE;
 END LOOP;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',customer,'role','authenticated','aal','aal1')::text,true);
 SET LOCAL ROLE authenticated;
 IF NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL customer requires MFA'; END IF;
 PERFORM private.require_staff_mfa();
 RESET ROLE;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=ca WHERE id=customer;
 SET LOCAL ROLE authenticated;
 IF private.staff_mfa_allowed() THEN RAISE EXCEPTION 'FAIL role promotion reused customer exemption'; END IF;
 RESET ROLE;
 IF has_function_privilege('authenticated','public.staff_mfa_edge_allowed(uuid,text,text)','EXECUTE')
  OR has_function_privilege('anon','public.staff_mfa_edge_allowed(uuid,text,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL client can forge Edge assurance'; END IF;
 IF has_table_privilege('authenticated','private.app_security','SELECT,UPDATE') THEN RAISE EXCEPTION 'FAIL client can alter enforcement'; END IF;
 SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
 WHERE ns.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity AND c.relname<>'profiles'
 AND NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='staff_mfa_required' AND NOT p.polpermissive);
 IF n<>0 THEN RAISE EXCEPTION 'FAIL % app tables lack restrictive MFA policy',n; END IF;
 RAISE NOTICE 'PASS: staff aal1 denied, live session/factor required, customer unchanged, bootstrap isolated, company scope retained';
END $test$;
ROLLBACK;
