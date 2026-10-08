-- Execute after core.sql in a rollback-only transaction.
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
CREATE TEMP TABLE admin_read_ids AS SELECT gen_random_uuid() admin_user,gen_random_uuid() foreign_admin,
 gen_random_uuid() foreign_company,gen_random_uuid() foreign_type;
GRANT SELECT ON admin_read_ids TO authenticated,anon;
INSERT INTO public.companies(id,name,slug) SELECT foreign_company,'Admin read regression','admin-read-'||foreign_company FROM admin_read_ids;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT foreign_type,foreign_company,'Read regression' FROM admin_read_ids;
INSERT INTO auth.users(id,email) SELECT id,'admin-read-'||id||'@example.invalid' FROM admin_read_ids,
 LATERAL unnest(ARRAY[admin_user,foreign_admin]) s(id);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT company FROM test_ids) WHERE id=(SELECT admin_user FROM admin_read_ids);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT foreign_company FROM admin_read_ids) WHERE id=(SELECT foreign_admin FROM admin_read_ids);
UPDATE public.profiles SET company_id=(SELECT company FROM test_ids),first_name='Audit %_customer',last_name='' WHERE id=(SELECT customer FROM test_ids);
CREATE TEMP TABLE admin_read_customers AS SELECT gen_random_uuid() id,n FROM generate_series(1,61) n;
INSERT INTO auth.users(id,email) SELECT id,'admin-read-'||id||'@example.invalid' FROM admin_read_customers;
UPDATE public.profiles p SET company_id=(SELECT company FROM test_ids),first_name='Page customer',last_name=lpad(c.n::text,2,'0') FROM admin_read_customers c WHERE c.id=p.id;
INSERT INTO public.taxi_requests(company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,completed_at,estimated_price,final_price)
 SELECT company,customer,driver,vehicle_type,43.2,25.6,'Admin read regression',43.21,25.61,'Admin read regression',
 'completed',now(),999,1 FROM test_ids CROSS JOIN generate_series(1,1200);
INSERT INTO public.taxi_requests(company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,estimated_price)
 SELECT company,customer,vehicle_type,43.2,25.6,'Admin read regression',43.21,25.61,'Admin read regression','cancelled',999999 FROM test_ids;
INSERT INTO public.taxi_requests(company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,estimated_price,final_price,completed_at)
 SELECT a.foreign_company,t.customer,a.foreign_type,43.2,25.6,'Foreign regression',43.21,25.61,'Foreign regression','completed',800000,800000,now()
 FROM admin_read_ids a CROSS JOIN test_ids t;
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true) FROM admin_read_ids;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb;first_page jsonb;second_page jsonb; BEGIN
 r:=public.company_customers((SELECT company FROM test_ids),'%_');
 IF (r->>'total')::int<>1 OR (r#>>'{rows,0,totalTrips}')::int<>1201 OR (r#>>'{rows,0,totalSpent}')::numeric<>1215 THEN
  RAISE EXCEPTION 'FAIL exact scoped customer totals and literal search: %',r; END IF;
 first_page:=public.company_customers((SELECT company FROM test_ids),'Page customer',0);
 second_page:=public.company_customers((SELECT company FROM test_ids),'Page customer',1);
 IF (first_page->>'total')::int<>61 OR jsonb_array_length(first_page->'rows')<>50 OR jsonb_array_length(second_page->'rows')<>11 THEN
  RAISE EXCEPTION 'FAIL bounded customer pagination'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'rows') a JOIN jsonb_array_elements(second_page->'rows') b ON a->>'id'=b->>'id') THEN
  RAISE EXCEPTION 'FAIL duplicate customer between pages'; END IF;
 r:=public.company_fleet((SELECT company FROM test_ids));
 IF (r->>'total')::int<>1 OR r#>>'{rows,0,id}'<>(SELECT driver::text FROM test_ids) OR r#>>'{rows,0,position_at}' IS NULL THEN
  RAISE EXCEPTION 'FAIL fleet scope or device timestamp'; END IF;
END $test$;
SELECT pg_temp.must_fail('SELECT public.company_customers((SELECT company FROM test_ids),'''',-1)');
SELECT pg_temp.must_fail('SELECT public.company_customers((SELECT company FROM test_ids),repeat(''x'',81))');
SELECT pg_temp.must_fail('SELECT public.company_fleet((SELECT foreign_company FROM admin_read_ids))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',foreign_admin,'role','authenticated')::text,true) FROM admin_read_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.company_customers((SELECT company FROM test_ids))');
SELECT pg_temp.must_fail('SELECT public.company_fleet((SELECT company FROM test_ids))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated','user_metadata',json_build_object('role','SUPER_ADMIN'))::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.company_customers((SELECT company FROM test_ids))');
SELECT pg_temp.must_fail('SELECT public.company_fleet((SELECT company FROM test_ids))');
-- Saved-place RLS keeps ownership, including WITH CHECK after the optimization.
INSERT INTO public.saved_places(user_id,name,latitude,longitude) SELECT customer,'Audit place',43.2,25.6 FROM test_ids;
SELECT pg_temp.must_fail('UPDATE public.saved_places SET user_id=(SELECT other_customer FROM test_ids) WHERE name=''Audit place''');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN IF EXISTS(SELECT 1 FROM public.saved_places WHERE name='Audit place') THEN RAISE EXCEPTION 'FAIL saved place isolation'; END IF; END $test$;
RESET ROLE;
UPDATE public.profiles SET is_active=false WHERE id=(SELECT admin_user FROM admin_read_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true) FROM admin_read_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.company_customers((SELECT company FROM test_ids))');
SELECT pg_temp.must_fail('SELECT public.company_fleet((SELECT company FROM test_ids))');
RESET ROLE;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.company_customers(uuid,text,integer)'::regprocedure,'public.company_fleet(uuid)'::regprocedure) AND prosecdef)
 OR has_function_privilege('anon','public.company_customers(uuid,text,integer)','EXECUTE')
 OR has_function_privilege('anon','public.company_fleet(uuid)','EXECUTE') THEN RAISE EXCEPTION 'FAIL report ACL or RLS bypass'; END IF;
END $test$;
SELECT 'PASS: exact company-scoped customer totals over 1200 rides, cancellation exclusion, literal search, pagination, fleet device timestamp, role isolation and saved-place ownership' AS result;
