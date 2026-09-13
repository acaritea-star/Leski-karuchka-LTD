-- Run in a transaction and ROLLBACK. Synthetic fixtures never survive the test.
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
UPDATE public.drivers SET is_verified=true,vehicle_id=(SELECT vehicle FROM test_ids),is_online=true WHERE id=(SELECT driver FROM test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT driver,company,43.2,25.6,10,now() FROM test_ids;
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
