-- Standalone rollback-only test for retained JWTs after account deactivation.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); super_id uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 audit_id uuid:=gen_random_uuid(); foreign_audit uuid:=gen_random_uuid();
 ledger_id uuid:=gen_random_uuid(); foreign_ledger uuid:=gen_random_uuid();
 u uuid; expected integer; actual integer;
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(c,'Access fixture','access-'||c),(other_c,'Foreign access fixture','access-'||other_c);
 INSERT INTO auth.users(id,email) SELECT id,'access-'||id||'@example.invalid' FROM unnest(ARRAY[admin_id,super_id,customer]) s(id);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=c WHERE id=admin_id;
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=super_id;
 INSERT INTO public.audit_log(id,company_id,action,entity_type,entity_id)
 VALUES(audit_id,c,'test','test',c),(foreign_audit,other_c,'test','test',other_c);
 INSERT INTO public.ledger(id,company_id,account,entry_type,amount)
 VALUES(ledger_id,c,'test','credit',1),(foreign_ledger,other_c,'test','credit',1);
 FOREACH u IN ARRAY ARRAY[admin_id,super_id,customer] LOOP
  expected:=CASE WHEN u=admin_id THEN 1 WHEN u=super_id THEN 2 ELSE 0 END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO actual FROM public.audit_log WHERE id IN (audit_id,foreign_audit);
  IF actual<>expected THEN RAISE EXCEPTION 'FAIL active audit access'; END IF;
  SELECT count(*) INTO actual FROM public.ledger WHERE id IN (ledger_id,foreign_ledger);
  IF actual<>expected THEN RAISE EXCEPTION 'FAIL active ledger access'; END IF;
  RESET ROLE;
  UPDATE public.profiles SET is_active=false WHERE id=u;
  SET LOCAL ROLE authenticated;
  IF EXISTS(SELECT 1 FROM public.audit_log WHERE id IN (audit_id,foreign_audit)) THEN
   RAISE EXCEPTION 'FAIL deactivated account still reads audit log'; END IF;
  IF EXISTS(SELECT 1 FROM public.ledger WHERE id IN (ledger_id,foreign_ledger)) THEN
   RAISE EXCEPTION 'FAIL deactivated account still reads ledger'; END IF;
  RESET ROLE;
 END LOOP;
END $test$;
SELECT 'PASS: active company/super admin visibility, cross-company and customer isolation, immediate deactivation with retained JWT' AS result;
ROLLBACK;
