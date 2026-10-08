SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='30s';
DO $preflight$ BEGIN
 EXECUTE $definitions$-- Bounded, invoker-rights reads: never bypass row-level security.
CREATE OR REPLACE FUNCTION public.company_customers(p_company uuid, p_search text DEFAULT '', p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result jsonb; term text:=btrim(coalesce(p_search,''));
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Customer report scope not allowed' USING ERRCODE='42501';
 END IF;
 IF p_page IS NULL OR p_page<0 OR p_page>10000 OR length(term)>80 THEN
   RAISE EXCEPTION 'Invalid customer report page' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
   SELECT p.id,p.first_name,p.last_name,p.phone,p.avatar_url,p.created_at
   FROM public.profiles p WHERE p.company_id=p_company AND p.role='CUSTOMER'
    AND (term='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(term))>0)
 ), page AS (
   SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_page*50
 ), rows AS (
   SELECT p.*,totals.trips AS "totalTrips",totals.amount AS "totalSpent"
   FROM page p CROSS JOIN LATERAL (
     SELECT count(*) trips,coalesce(sum(coalesce(r.final_price,r.estimated_price,0)),0) amount
     FROM public.taxi_requests r WHERE r.company_id=p_company AND r.customer_id=p.id AND r.status='completed'
   ) totals
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matching),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) FROM rows r),'[]'::jsonb)) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.company_customers(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_customers(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.company_fleet(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result jsonb;
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Fleet scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH visible AS MATERIALIZED (
   SELECT d.id,p.first_name,p.last_name,d.is_online,l.latitude,l.longitude,l.updated_at,l.position_at
   FROM public.driver_locations l JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=p_company
   JOIN public.profiles p ON p.id=d.user_id
   WHERE l.company_id=p_company
 ), page AS (
   SELECT * FROM visible ORDER BY is_online DESC,updated_at DESC,id LIMIT 500
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM visible),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.is_online DESC,p.updated_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.company_fleet(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_fleet(uuid) TO authenticated;

-- Leading columns match report filters, ownership checks and customer lookup.
CREATE INDEX IF NOT EXISTS outcomes_driver_id_time ON public.request_outcomes(driver_id,occurred_at DESC,id);
CREATE INDEX IF NOT EXISTS money_driver_id_time ON public.driver_money_entries(driver_id,recorded_at DESC,id);
CREATE INDEX IF NOT EXISTS saved_places_user_id_idx ON public.saved_places(user_id);
CREATE INDEX IF NOT EXISTS ratings_customer_id_idx ON public.ratings(customer_id);
CREATE INDEX IF NOT EXISTS requests_company_customer_completed_idx ON public.taxi_requests(company_id,customer_id) WHERE status='completed';

NOTIFY pgrst,'reload schema';

-- Only statement-constant auth.uid() calls change; ownership expressions and roles are retained.
-- The second unique index remains attached to its UNIQUE constraint.
DROP INDEX IF EXISTS public.idx_push_subscriptions_user_endpoint;
ALTER POLICY "payment_transactions_select_customer" ON "public"."payment_transactions"
 USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.id = payment_transactions.request_id) AND (tr.customer_id = (select auth.uid()))))));

ALTER POLICY "ratings_select_customer" ON "public"."ratings"
 USING ((customer_id = (select auth.uid())));

ALTER POLICY "saved_places_select_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_insert_own" ON "public"."saved_places"
 WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_update_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())))
 WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_delete_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())));

ALTER POLICY "push_subscriptions_delete_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id));

ALTER POLICY "audit_log_select_admin" ON "public"."audit_log"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = audit_log.company_id)))))));

ALTER POLICY "ledger_select_admin" ON "public"."ledger"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = ledger.company_id)))))));

ALTER POLICY "push_subscriptions_select_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id));

ALTER POLICY "push_subscriptions_insert_own" ON "public"."push_subscriptions"
 WITH CHECK (((select auth.uid()) = user_id));

ALTER POLICY "push_subscriptions_update_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id))
 WITH CHECK (((select auth.uid()) = user_id));

ALTER POLICY "vehicles_select_trip_party" ON "public"."vehicles"
 USING ((EXISTS ( SELECT 1
   FROM (drivers d
     JOIN taxi_requests r ON ((r.driver_id = d.id)))
  WHERE ((d.vehicle_id = vehicles.id) AND (r.customer_id = (select auth.uid()))))));

$definitions$;
 EXECUTE $fixture$-- Run in a transaction and ROLLBACK. Synthetic fixtures never survive the test.
CREATE TEMP TABLE test_ids AS SELECT gen_random_uuid() customer,gen_random_uuid() other_customer,gen_random_uuid() driver_user,
 gen_random_uuid() company,gen_random_uuid() vehicle_type,gen_random_uuid() vehicle,gen_random_uuid() driver,gen_random_uuid() quote,gen_random_uuid() request;
GRANT SELECT ON test_ids TO authenticated;
INSERT INTO public.companies(id,name,slug) SELECT company,'Integration test','integration-'||company FROM test_ids;
INSERT INTO auth.users(id,email,raw_user_meta_data) SELECT customer,'customer-'||customer||'@example.invalid','{"role":"SUPER_ADMIN"}'::jsonb FROM test_ids;
INSERT INTO auth.users(id,email) SELECT other_customer,'other-'||other_customer||'@example.invalid' FROM test_ids;
INSERT INTO auth.users(id,email) SELECT driver_user,'driver-'||driver_user||'@example.invalid' FROM test_ids;
DO $$ BEGIN IF (SELECT role FROM public.profiles WHERE id=(SELECT customer FROM test_ids))<>'CUSTOMER' THEN RAISE EXCEPTION 'FAIL signup escalation'; END IF; END $$;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT vehicle_type,company,'Test car' FROM test_ids;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number) SELECT vehicle,company,vehicle_type,'Test','Test','TEST-'||left(vehicle::text,8) FROM test_ids;
UPDATE public.profiles SET company_id=(SELECT company FROM test_ids),role='DRIVER' WHERE id=(SELECT driver_user FROM test_ids);
UPDATE test_ids SET driver=(SELECT id FROM public.drivers WHERE user_id=test_ids.driver_user);
UPDATE public.drivers SET document_verification_required=false WHERE id=(SELECT driver FROM test_ids);
UPDATE public.drivers SET is_verified=true,vehicle_id=(SELECT vehicle FROM test_ids),is_online=false WHERE id=(SELECT driver FROM test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT driver,company,43.2,25.6,10,now() FROM test_ids;
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,'{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.3,"destination_longitude":25.7,"pickup_address":"Test pickup","destination_address":"Test destination","distance_km":12,"duration_min":20,"total":15,"breakdown":{"total":15}}'::jsonb FROM test_ids;
CREATE FUNCTION pg_temp.must_fail(q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN RETURN; END;
 RAISE EXCEPTION 'FAIL: forbidden statement succeeded: %',q;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('UPDATE public.profiles SET role=''SUPER_ADMIN'' WHERE id=(SELECT customer FROM test_ids)');
UPDATE public.profiles SET first_name='Allowed edit' WHERE id=(SELECT customer FROM test_ids);
SELECT pg_temp.must_fail('SELECT public.sweep_stuck_requests(0)');
SELECT pg_temp.must_fail('SELECT public.expire_stale_requests()');

SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL AS created FROM test_ids;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL AS retry_idempotent FROM test_ids;
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET estimated_price=0 WHERE id=(SELECT request FROM test_ids)');
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET status=''completed'' WHERE id=(SELECT request FROM test_ids)');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)) THEN RAISE EXCEPTION 'FAIL customer isolation'; END IF; END $$;
SELECT pg_temp.must_fail('SELECT public.create_taxi_request(quote,request,''cash'') FROM test_ids');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('UPDATE public.drivers SET is_verified=false WHERE id=(SELECT driver FROM test_ids)');
SELECT pg_temp.must_fail('UPDATE public.driver_locations SET latitude=999 WHERE driver_id=(SELECT driver FROM test_ids)');
SELECT pg_temp.must_fail('UPDATE public.driver_locations SET position_at=now()-interval ''5 minutes'' WHERE driver_id=(SELECT driver FROM test_ids)');
UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status='accepted' WHERE id=(SELECT request FROM test_ids) AND status='pending';
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET status=''completed'' WHERE id=(SELECT request FROM test_ids)');
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT request FROM test_ids);
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT request FROM test_ids);
RESET ROLE;
UPDATE public.taxi_requests SET updated_at=now()-interval '2 hours' WHERE id=(SELECT request FROM test_ids);
SELECT public.sweep_stuck_requests(1);
DO $$ BEGIN IF (SELECT status FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids))<>'in_progress' THEN RAISE EXCEPTION 'FAIL long trip cancelled'; END IF; END $$;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='completed',final_price=9999 WHERE id=(SELECT request FROM test_ids);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT final_price FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids))<>15 THEN RAISE EXCEPTION 'FAIL forged fare'; END IF;
 IF (SELECT count(*) FROM public.trips WHERE request_id=(SELECT request FROM test_ids))<>1 THEN RAISE EXCEPTION 'FAIL trip not created exactly once'; END IF;
 IF (SELECT distance_km FROM public.trips WHERE request_id=(SELECT request FROM test_ids))<>12 THEN RAISE EXCEPTION 'FAIL trip distance'; END IF;
END $$;
SELECT 'PASS: signup, profile protection, role isolation, maintenance access, GPS validation, quote ownership/idempotency, lifecycle, long-trip preservation, fare integrity, trip record' AS result;
$fixture$;
 EXECUTE $regression$-- Execute after core.sql in a rollback-only transaction.
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
$regression$;
 RAISE EXCEPTION 'Preflight complete; restore schema and fixtures' USING ERRCODE='ZA001';
EXCEPTION WHEN SQLSTATE 'ZA001' THEN RAISE NOTICE 'PASS: all preflight changes rolled back'; END $preflight$;
