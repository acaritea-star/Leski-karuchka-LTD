-- Account/role/RLS/receipt regression. Synthetic rows, always rolled back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE c uuid:=gen_random_uuid(); foreign_c uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid(); customer_id uuid:=gen_random_uuid();
 d uuid; m jsonb; receipt jsonb; retry jsonb; report jsonb; denied boolean;
 terms text; privacy text; count_rows integer;
 answers jsonb:='{"background":"foreground","cash":"reconcile","responsibility":"carrier"}';
BEGIN
 SELECT terms_version,privacy_version INTO STRICT terms,privacy FROM private.legal_versions WHERE is_current;
 INSERT INTO public.companies(id,name,slug) VALUES(c,'Preparation fixture','prep-'||c),(foreign_c,'Foreign preparation','prep-'||foreign_c);
 INSERT INTO auth.users(id,email) SELECT id,'prep-'||id||'@example.invalid' FROM unnest(ARRAY[u,admin_id,foreign_id,customer_id]) s(id);
 UPDATE public.profiles SET role='DRIVER',company_id=c WHERE id=u;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=c WHERE id=admin_id;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=foreign_c WHERE id=foreign_id;
 UPDATE public.profiles SET company_id=c WHERE id=customer_id;
 SELECT id INTO STRICT d FROM public.drivers WHERE user_id=u;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 m:=public.driver_preparation_materials();
 IF m->>'driver_id'<>d::text OR m->'receipt'<>'null'::jsonb THEN RAISE EXCEPTION 'FAIL initial materials'; END IF;
 report:=public.driver_verification_status(d);
 IF (report#>>'{preparation,complete}')::boolean THEN RAISE EXCEPTION 'FAIL unchecked completion'; END IF;
 denied:=false;BEGIN
  PERFORM public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash','{"background":"guaranteed"}',terms,privacy);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 IF NOT denied OR EXISTS(SELECT 1 FROM public.driver_preparation_acceptances WHERE driver_id=d) OR EXISTS(SELECT 1 FROM public.legal_acceptances WHERE user_id=u) THEN RAISE EXCEPTION 'FAIL wrong quiz changes any legal state'; END IF;
 denied:=false;BEGIN
  PERFORM public.accept_driver_preparation(d,'cached-old',m#>>'{document,trainingVersion}',m->>'content_hash',answers,terms,privacy);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL stale terms accepted'; END IF;
 denied:=false;BEGIN
  PERFORM public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',repeat('0',64),answers,terms,privacy);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL forged content accepted'; END IF;
 denied:=false;BEGIN
  PERFORM public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',answers,'cached-general',privacy);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL stale general legal version accepted'; END IF;
 receipt:=public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',answers,terms,privacy);
 retry:=public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',answers,terms,privacy);
 IF receipt IS DISTINCT FROM retry OR receipt->>'user_id'<>u::text OR receipt->>'company_id'<>c::text OR receipt->>'content_hash'<>m->>'content_hash' THEN RAISE EXCEPTION 'FAIL stable receipt/provenance'; END IF;
 IF (SELECT count(*) FROM public.driver_preparation_acceptances WHERE driver_id=d)<>1 OR (SELECT count(*) FROM public.legal_acceptances WHERE user_id=u AND terms_version=terms AND privacy_version=privacy)<>1 THEN RAISE EXCEPTION 'FAIL idempotent atomic legal records'; END IF;
 IF jsonb_array_length(public.export_my_basic_data()->'driver_preparation_acceptances')<>1 THEN RAISE EXCEPTION 'FAIL preparation privacy export'; END IF;
 IF (public.driver_preparation_materials()#>>'{receipt,id}')<>receipt->>'id' THEN RAISE EXCEPTION 'FAIL confirmed material receipt'; END IF;
 denied:=false;BEGIN UPDATE public.driver_preparation_acceptances SET accepted_at=now()-interval '1 year' WHERE driver_id=d;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL editable evidence'; END IF;
 denied:=false;BEGIN DELETE FROM public.driver_preparation_acceptances WHERE driver_id=d;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL deleted evidence'; END IF;
 denied:=false;BEGIN
  INSERT INTO public.driver_preparation_acceptances(driver_id,user_id,company_id,terms_version,training_version,content_hash)
  VALUES(d,u,c,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL forged direct receipt'; END IF;
 denied:=false;BEGIN PERFORM 1 FROM private.driver_policy_versions;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL private answer-key exposure'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF NOT EXISTS(SELECT 1 FROM public.driver_preparation_acceptances WHERE driver_id=d) OR NOT (public.driver_verification_status(d)#>>'{preparation,complete}')::boolean THEN RAISE EXCEPTION 'FAIL own-company admin status'; END IF;
 denied:=false;BEGIN
  PERFORM public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',answers,terms,privacy);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL admin accepts for driver'; END IF;
 denied:=false;BEGIN PERFORM public.driver_preparation_materials();EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL non-driver training access'; END IF;
 RESET ROLE;
 FOREACH foreign_id IN ARRAY ARRAY[foreign_id,customer_id] LOOP
  PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_id,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  IF EXISTS(SELECT 1 FROM public.driver_preparation_acceptances WHERE driver_id=d) THEN RAISE EXCEPTION 'FAIL other account receipt visibility'; END IF;
  denied:=false;BEGIN PERFORM private.driver_preparation_status(d);EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL foreign status'; END IF;
  denied:=false;BEGIN
   PERFORM public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',answers,terms,privacy);
  EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL foreign driver receipt'; END IF;
  RESET ROLE;
 END LOOP;
 UPDATE public.profiles SET is_active=false WHERE id=u;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 denied:=false;BEGIN PERFORM public.driver_preparation_materials();EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL inactive driver materials'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 denied:=false;BEGIN PERFORM public.driver_preparation_materials();EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL anonymous material access'; END IF;
 denied:=false;BEGIN PERFORM 1 FROM public.driver_preparation_acceptances;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL anonymous receipt access'; END IF;
 RESET ROLE;
 PERFORM set_config('leski.preparation_test',jsonb_build_object('passed',true,'acceptance','personal, current-version, atomic and idempotent','training','server-checked answers','isolation','driver and same-company admin','evidence','immutable and exported')::text,true);
END $test$;
SELECT current_setting('leski.preparation_test')::jsonb AS result;
ROLLBACK;
