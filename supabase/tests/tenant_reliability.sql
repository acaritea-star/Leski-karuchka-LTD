-- Independent transaction. Synthetic identities; no email, map or other outbound calls.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE TEMP TABLE tenant_test AS SELECT gen_random_uuid() a,gen_random_uuid() b,gen_random_uuid() admin_a,
 gen_random_uuid() admin_b,gen_random_uuid() root,gen_random_uuid() user_a,gen_random_uuid() user_b,
 gen_random_uuid() candidate_a,gen_random_uuid() candidate_b,gen_random_uuid() unconfirmed,
 gen_random_uuid() type_a,gen_random_uuid() type_b,gen_random_uuid() car_a,gen_random_uuid() car_b,
 gen_random_uuid() invite_a,gen_random_uuid() invite_b,gen_random_uuid() accepted_a;
GRANT SELECT ON tenant_test TO authenticated,anon;
CREATE FUNCTION pg_temp.tenant_must_deny(q text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL: unauthorized tenant operation succeeded: %',q;
END $fn$;
INSERT INTO public.companies(id,name,slug,setup_completed_at)
 SELECT id,'Tenant regression','tenant-test-'||id,now() FROM tenant_test,LATERAL unnest(ARRAY[a,b]) ids(id);
INSERT INTO auth.users(id,email,email_confirmed_at)
 SELECT id,'tenant-'||id||'@example.invalid',CASE WHEN id=unconfirmed THEN NULL ELSE now() END
 FROM tenant_test,LATERAL unnest(ARRAY[admin_a,admin_b,root,user_a,user_b,candidate_a,candidate_b,unconfirmed]) ids(id);
UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=(SELECT root FROM tenant_test);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT a FROM tenant_test) WHERE id=(SELECT admin_a FROM tenant_test);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT b FROM tenant_test) WHERE id=(SELECT admin_b FROM tenant_test);
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT a FROM tenant_test),first_name='GPS %_ driver',last_name='' WHERE id=(SELECT user_a FROM tenant_test);
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT b FROM tenant_test),first_name='Foreign driver',last_name='' WHERE id=(SELECT user_b FROM tenant_test);
CREATE TEMP TABLE tenant_more AS SELECT gen_random_uuid() id,n FROM generate_series(1,60) n;
INSERT INTO auth.users(id,email,email_confirmed_at) SELECT id,'tenant-'||id||'@example.invalid',now() FROM tenant_more;
UPDATE public.profiles p SET role='DRIVER',company_id=(SELECT a FROM tenant_test),first_name='Page driver',last_name=lpad(x.n::text,2,'0') FROM tenant_more x WHERE p.id=x.id;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT type_a,a,'Test' FROM tenant_test UNION ALL SELECT type_b,b,'Test' FROM tenant_test;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT car_a,a,type_a,'Test','Test','TA-'||left(car_a::text,8) FROM tenant_test UNION ALL
 SELECT car_b,b,type_b,'Test','Test','TB-'||left(car_b::text,8) FROM tenant_test;
UPDATE public.drivers SET document_verification_required=false,vehicle_id=(SELECT car_a FROM tenant_test),is_verified=true WHERE user_id=(SELECT user_a FROM tenant_test);
UPDATE public.drivers SET document_verification_required=false,vehicle_id=(SELECT car_b FROM tenant_test),is_verified=true WHERE user_id=(SELECT user_b FROM tenant_test);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT id,company_id,43.2,25.6,10,now() FROM public.drivers WHERE user_id IN (SELECT user_a FROM tenant_test UNION ALL SELECT user_b FROM tenant_test);
UPDATE public.drivers SET is_online=true WHERE user_id IN (SELECT user_a FROM tenant_test UNION ALL SELECT user_b FROM tenant_test);
SELECT set_config('request.jwt.claims',json_build_object('sub',root,'role','authenticated')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
SELECT public.create_partner_invitation(invite_a,'driver','tenant-'||candidate_a||'@example.invalid',a) FROM tenant_test;
SELECT public.create_partner_invitation(invite_b,'driver','tenant-'||candidate_b||'@example.invalid',b) FROM tenant_test;
DO $test$ BEGIN
 IF public.resolve_partner_access('driver',(SELECT invite_a FROM tenant_test))->>'status'<>'denied'
 OR public.resolve_partner_access('any',NULL)->>'destination'<>'/admin/companies' THEN RAISE EXCEPTION 'FAIL explicit foreign link or super role'; END IF;
END $test$;
RESET ROLE;
INSERT INTO public.partner_invitations(id,kind,email,company_id,created_by,status,accepted_by,accepted_at)
 SELECT accepted_a,'driver','tenant-'||user_a||'@example.invalid',a,root,'accepted',user_a,now() FROM tenant_test;
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_a,'role','authenticated')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE first_page jsonb;second_page jsonb;r jsonb;BEGIN
 first_page:=public.company_driver_page((SELECT a FROM tenant_test),'',0);
 second_page:=public.company_driver_page((SELECT a FROM tenant_test),'',1);
 IF (first_page->>'total')::int<>61 OR jsonb_array_length(first_page->'rows')<>50 OR jsonb_array_length(second_page->'rows')<>11 THEN RAISE EXCEPTION 'FAIL bounded driver pages'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x JOIN jsonb_array_elements(second_page->'rows') y ON x->>'id'=y->>'id') THEN RAISE EXCEPTION 'FAIL repeated driver page'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') x WHERE x->>'company_id'<>(SELECT a::text FROM tenant_test)) THEN RAISE EXCEPTION 'FAIL foreign driver row'; END IF;
 r:=public.company_driver_page((SELECT a FROM tenant_test),'%_');
 IF (r->>'total')::int<>1 OR NOT (r#>>'{rows,0,online_now}')::boolean THEN RAISE EXCEPTION 'FAIL literal search or current online status'; END IF;
 IF (public.company_dashboard((SELECT a FROM tenant_test))#>>'{stats,onlineDrivers}')::int<>1
 OR NOT (public.company_fleet((SELECT a FROM tenant_test))#>>'{rows,0,is_online}')::boolean THEN RAISE EXCEPTION 'FAIL consistent online screens'; END IF;
 IF EXISTS(SELECT 1 FROM public.drivers WHERE company_id=(SELECT b FROM tenant_test))
 OR EXISTS(SELECT 1 FROM public.driver_locations WHERE company_id=(SELECT b FROM tenant_test))
 OR EXISTS(SELECT 1 FROM public.partner_invitations WHERE company_id=(SELECT b FROM tenant_test)) THEN RAISE EXCEPTION 'FAIL raw tenant RLS'; END IF;
 IF public.resolve_partner_access('driver',(SELECT invite_b FROM tenant_test))->>'status'<>'denied'
 OR public.resolve_partner_access('any',NULL)->>'company_id'<>(SELECT a::text FROM tenant_test) THEN RAISE EXCEPTION 'FAIL existing firm account accepts foreign link'; END IF;
END $test$;
SELECT pg_temp.tenant_must_deny('SELECT public.company_driver_page((SELECT b FROM tenant_test))');
SELECT pg_temp.tenant_must_deny('SELECT public.company_dashboard((SELECT b FROM tenant_test))');
SELECT pg_temp.tenant_must_deny('SELECT public.company_fleet((SELECT b FROM tenant_test))');
DO $test$ BEGIN
 BEGIN PERFORM public.company_driver_page((SELECT a FROM tenant_test),'',-1); RAISE EXCEPTION 'FAIL negative page'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
-- A recent heartbeat cannot refresh an old device fix.
UPDATE public.driver_locations SET position_at=now()-interval '60 seconds' WHERE driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT user_a FROM tenant_test));
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 IF (public.company_dashboard((SELECT a FROM tenant_test))#>>'{stats,onlineDrivers}')::int<>0
 OR (public.company_fleet((SELECT a FROM tenant_test))#>>'{rows,0,is_online}')::boolean
 OR (public.company_driver_page((SELECT a FROM tenant_test),'%_')#>>'{rows,0,online_now}')::boolean THEN RAISE EXCEPTION 'FAIL stale GPS counted online'; END IF;
END $test$;
RESET ROLE;
UPDATE public.driver_locations SET position_at=now() WHERE driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT user_a FROM tenant_test));
UPDATE public.profiles SET is_active=false WHERE id=(SELECT user_a FROM tenant_test);
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 IF (public.company_dashboard((SELECT a FROM tenant_test))#>>'{stats,onlineDrivers}')::int<>0
 OR (public.company_fleet((SELECT a FROM tenant_test))#>>'{rows,0,is_online}')::boolean THEN RAISE EXCEPTION 'FAIL inactive profile counted online'; END IF;
END $test$;
RESET ROLE;
UPDATE public.profiles SET is_active=true WHERE id=(SELECT user_a FROM tenant_test);
SELECT set_config('request.jwt.claims',json_build_object('sub',user_a,'role','authenticated','email','tenant-'||candidate_a||'@example.invalid')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 IF public.resolve_partner_access('driver',(SELECT invite_a FROM tenant_test))->>'status'<>'denied'
 OR public.resolve_partner_access('driver',(SELECT accepted_a FROM tenant_test))->>'destination'<>'/driver/home' THEN RAISE EXCEPTION 'FAIL existing driver foreign or own accepted link'; END IF;
END $test$;
SELECT pg_temp.tenant_must_deny('SELECT public.company_driver_page((SELECT a FROM tenant_test))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',candidate_a,'role','authenticated','user_metadata',json_build_object('role','SUPER_ADMIN'))::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
SELECT pg_temp.tenant_must_deny('SELECT public.company_driver_page((SELECT a FROM tenant_test))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',unconfirmed,'role','authenticated')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN IF public.resolve_partner_access('driver',(SELECT invite_a FROM tenant_test))->>'reason'<>'missing_email' THEN RAISE EXCEPTION 'FAIL unconfirmed email'; END IF; END $test$;
RESET ROLE;
UPDATE public.profiles SET is_active=false WHERE id=(SELECT admin_a FROM tenant_test);
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_a,'role','authenticated')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
SELECT pg_temp.tenant_must_deny('SELECT public.company_driver_page((SELECT a FROM tenant_test))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',root,'role','authenticated')::text,true) FROM tenant_test;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 IF (public.company_driver_page((SELECT b FROM tenant_test))->>'total')::int<>1 THEN RAISE EXCEPTION 'FAIL scoped super administration'; END IF;
 IF private.fleet_online(true,true,now(),now()-interval '45 seconds',now())
 OR private.fleet_online(true,true,now(),now()+interval '31 seconds',now())
 OR private.fleet_online(true,true,NULL,now(),now())
 OR private.fleet_online(true,false,now(),now(),now()) THEN RAISE EXCEPTION 'FAIL freshness boundaries'; END IF;
END $test$;
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.tenant_must_deny('SELECT public.company_driver_page((SELECT a FROM tenant_test))');
RESET ROLE;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.company_driver_page(uuid,text,integer)'::regprocedure AND prosecdef)
 OR has_function_privilege('anon','public.company_driver_page(uuid,text,integer)','EXECUTE') THEN RAISE EXCEPTION 'FAIL scoped page ACL'; END IF;
END $test$;
SELECT 'PASS: tenant driver pages, raw RLS, all online views, GPS expiry, role changes and explicit email-matched URLs' AS result;
ROLLBACK;
