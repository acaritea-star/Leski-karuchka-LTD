-- A prior personal receipt is preserved but cannot stand for unseen new terms.
BEGIN;
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid; old_id uuid:=gen_random_uuid();
 old_version private.driver_policy_versions; m jsonb; r jsonb; retry jsonb; denied boolean:=false;
 general_terms text; privacy text; old_time timestamptz:='2026-10-09T20:00:00Z';
BEGIN
 SELECT * INTO STRICT old_version FROM private.driver_policy_versions
  WHERE terms_version='2026-10-09-driver.1' AND training_version='2026-10-09.1';
 IF old_version.is_current OR old_version.content_hash<>'5f4e2d7898ff8ca7197dc7929453db805b77cd88b501f8e8fc6a62f1f46f6d53' THEN
  RAISE EXCEPTION 'FAIL original policy document replaced'; END IF;
 SELECT terms_version,privacy_version INTO STRICT general_terms,privacy FROM private.legal_versions WHERE is_current;
 INSERT INTO public.companies(id,name,slug) VALUES(c,'Version history fixture','history-'||c);
 INSERT INTO auth.users(id,email) VALUES(u,'history-'||u||'@example.invalid');
 UPDATE public.profiles SET role='DRIVER',company_id=c WHERE id=u;
 SELECT id INTO STRICT d FROM public.drivers WHERE user_id=u;
 INSERT INTO public.driver_preparation_acceptances(id,driver_id,user_id,company_id,terms_version,training_version,content_hash,accepted_at,training_completed_at)
 VALUES(old_id,d,u,c,old_version.terms_version,old_version.training_version,old_version.content_hash,old_time,old_time);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 m:=public.driver_preparation_materials();
 IF m->'receipt'<>'null'::jsonb OR m#>>'{document,termsVersion}'=old_version.terms_version THEN
  RAISE EXCEPTION 'FAIL old receipt silently accepts new conditions'; END IF;
 BEGIN
  PERFORM public.accept_driver_preparation(d,old_version.terms_version,old_version.training_version,old_version.content_hash,old_version.answers,general_terms,privacy);
 EXCEPTION WHEN invalid_parameter_value THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL stale client accepted old version'; END IF;
 r:=public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',old_version.answers,general_terms,privacy);
 retry:=public.accept_driver_preparation(d,m#>>'{document,termsVersion}',m#>>'{document,trainingVersion}',m->>'content_hash',old_version.answers,general_terms,privacy);
 IF r IS DISTINCT FROM retry OR r->>'id'=old_id::text OR (SELECT count(*) FROM public.driver_preparation_acceptances WHERE driver_id=d)<>2 THEN
  RAISE EXCEPTION 'FAIL new acceptance overwrites or duplicates receipt'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.driver_preparation_acceptances WHERE id=old_id AND accepted_at=old_time
  AND training_completed_at=old_time AND content_hash=old_version.content_hash) THEN
  RAISE EXCEPTION 'FAIL previous personal evidence changed'; END IF;
 IF jsonb_array_length(public.export_my_basic_data()->'driver_preparation_acceptances')<>2 THEN
  RAISE EXCEPTION 'FAIL history omitted from personal export'; END IF;
 RESET ROLE;
 PERFORM set_config('leski.preparation_history',jsonb_build_object('passed',true,'receipts','old and new retained independently','stale_client','requires the current version')::text,true);
END $test$;
SELECT current_setting('leski.preparation_history')::jsonb AS result;
ROLLBACK;
