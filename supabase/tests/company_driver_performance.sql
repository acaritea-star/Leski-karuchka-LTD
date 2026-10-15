-- Synthetic bounded-read benchmark; CI localhost only, rolled back in full.
BEGIN;
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE isolation_load_companies AS SELECT gen_random_uuid() id,n FROM generate_series(1,20) n;
CREATE TEMP TABLE isolation_load_users AS SELECT gen_random_uuid() id,c.id company_id,n
 FROM isolation_load_companies c CROSS JOIN generate_series(1,50) n;
INSERT INTO public.companies(id,name,slug,setup_completed_at)
 SELECT id,'Load fixture '||n,'isolation-load-'||id,now() FROM isolation_load_companies;
INSERT INTO auth.users(id,email) SELECT id,'load-'||id||'@example.invalid' FROM isolation_load_users;
UPDATE public.profiles p SET role='DRIVER',company_id=u.company_id,first_name='Load',last_name=u.n::text
 FROM isolation_load_users u WHERE p.id=u.id;
DO $test$
DECLARE admin_id uuid:=gen_random_uuid(); selected_company uuid; page jsonb; started timestamptz; elapsed numeric;
BEGIN
 SELECT id INTO STRICT selected_company FROM isolation_load_companies WHERE n=1;
 INSERT INTO auth.users(id,email) VALUES(admin_id,'load-admin-'||admin_id||'@example.invalid');
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=selected_company WHERE id=admin_id;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 started:=clock_timestamp();
 SET LOCAL ROLE authenticated;
 FOR iteration IN 1..20 LOOP
  page:=public.company_driver_page(selected_company,'',0);
  IF (page->>'total')::int<>50 OR jsonb_array_length(page->'rows')<>50
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(page->'rows') r WHERE r->>'company_id'<>selected_company::text)
  THEN RAISE EXCEPTION 'FAIL bounded page or foreign-firm row at scale'; END IF;
 END LOOP;
 RESET ROLE;
 elapsed:=extract(epoch FROM clock_timestamp()-started)*1000;
 RAISE NOTICE 'PASS company driver load: %',jsonb_build_object('companies',20,'drivers',1000,'reads',20,'rows_per_page',50,
  'total_ms',round(elapsed,2),'mean_server_ms',round(elapsed/20,2),'foreign_rows',0);
END $test$;
ROLLBACK;
