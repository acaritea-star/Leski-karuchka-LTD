-- Follows reliable_dispatch.sql inside the same BEGIN/ROLLBACK transaction.
-- Contender scenarios are sequential; unique indexes and row locks are also
-- checked separately. This is not a two-connection timing stress test.
RESET ROLE;
ALTER TABLE test_ids ADD COLUMN contender_user uuid DEFAULT gen_random_uuid(),
 ADD COLUMN contender uuid, ADD COLUMN contender_vehicle uuid DEFAULT gen_random_uuid(),
 ADD COLUMN second_request uuid DEFAULT gen_random_uuid(), ADD COLUMN second_quote uuid DEFAULT gen_random_uuid();
INSERT INTO auth.users(id,email) SELECT contender_user,'contender-'||contender_user||'@example.invalid' FROM test_ids;
UPDATE public.profiles SET company_id=(SELECT company FROM test_ids),role='DRIVER' WHERE id=(SELECT contender_user FROM test_ids);
UPDATE test_ids SET contender=(SELECT id FROM public.drivers WHERE user_id=test_ids.contender_user);
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT contender_vehicle,company,vehicle_type,'Test','Contender','TEST-'||left(contender_vehicle::text,8) FROM test_ids;
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT contender,company,42.6977,23.3219,10,clock_timestamp() FROM test_ids;
-- Legacy fixture; real document eligibility is exercised in driver_verification.sql.
UPDATE public.drivers SET document_verification_required=false
 WHERE id=(SELECT contender FROM test_ids);
UPDATE public.drivers SET is_verified=true,vehicle_id=(SELECT contender_vehicle FROM test_ids),is_online=true
 WHERE id=(SELECT contender FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',contender_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.accept_taxi_request((SELECT request FROM test_ids))');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT driver_id FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids))<>(SELECT driver FROM test_ids) THEN
  RAISE EXCEPTION 'FAIL original acceptance was replaced'; END IF;
END $$;
-- A different customer requests another ride while the first driver is busy.
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT second_quote,other_customer,company,vehicle_type,
 '{"pickup_latitude":42.6977,"pickup_longitude":23.3219,"destination_latitude":42.70,"destination_longitude":23.33,"pickup_address":"Second fixture","destination_address":"Destination fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(second_quote,second_request,'cash') IS NOT NULL FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SELECT pg_temp.must_fail('SELECT public.accept_taxi_request((SELECT second_request FROM test_ids))');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.taxi_requests WHERE driver_id=(SELECT driver FROM test_ids) AND status IN ('accepted','arrived','in_progress'))<>1 THEN
  RAISE EXCEPTION 'FAIL driver has multiple active rides'; END IF;
 IF (SELECT status FROM public.taxi_requests WHERE id=(SELECT second_request FROM test_ids))<>'pending' THEN
  RAISE EXCEPTION 'FAIL busy acceptance changed second request'; END IF;
 -- Even privileged writes cannot bypass the database uniqueness guarantee.
 BEGIN
  UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status='accepted' WHERE id=(SELECT second_request FROM test_ids);
  RAISE EXCEPTION 'FAIL unique active-driver constraint missing';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',contender_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.accept_taxi_request(second_request) IS NOT NULL FROM test_ids;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT driver_id FROM public.taxi_requests WHERE id=(SELECT second_request FROM test_ids))<>(SELECT contender FROM test_ids) THEN
  RAISE EXCEPTION 'FAIL available second driver could not accept'; END IF;
END $$;
SELECT 'PASS: competing driver rejected, busy driver rejected, active-driver uniqueness, available contender accepted' AS result;
