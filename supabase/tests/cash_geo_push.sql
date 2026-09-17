-- Runs after core.sql, inside the same rollback-only transaction.
RESET ROLE;
UPDATE test_ids SET quote=gen_random_uuid(),request=gen_random_uuid();
UPDATE public.companies SET dispatch_radius_km=5 WHERE id=(SELECT company FROM test_ids);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
SELECT quote,customer,company,vehicle_type,
 '{"pickup_latitude":42.6977,"pickup_longitude":23.3219,"destination_latitude":42.70,"destination_longitude":23.33,"pickup_address":"Test Sofia","destination_address":"Test destination","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.create_taxi_request(quote,request,''card'') FROM test_ids');
SELECT pg_temp.must_fail('SELECT public.create_taxi_request(quote,request,''online'') FROM test_ids');
SELECT pg_temp.must_fail('SELECT public.create_taxi_request(quote,request,NULL) FROM test_ids');
SELECT pg_temp.must_fail('INSERT INTO public.taxi_requests(id) VALUES(gen_random_uuid())');
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
RESET ROLE;

-- Validate the driver feed, direct acceptance and push audience together.
CREATE FUNCTION pg_temp.expect_dispatch(expected boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE visible boolean; audience boolean; changed integer;
BEGIN
  SELECT EXISTS(SELECT 1 FROM public.request_push_recipients((SELECT request FROM test_ids))
    WHERE user_id=(SELECT driver_user FROM test_ids)) INTO audience;
  IF audience IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL push audience: expected %',expected; END IF;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
  SET LOCAL ROLE authenticated;
  SELECT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)) INTO visible;
  IF visible IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL request visibility: expected %',expected; END IF;
  IF NOT expected THEN
    UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status='accepted'
      WHERE id=(SELECT request FROM test_ids);
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>0 THEN RAISE EXCEPTION 'FAIL ineligible driver accepted ride'; END IF;
  END IF;
  RESET ROLE;
END $$;

-- Same company, fresh GPS, but physically in Tarnovo: no Sofia order.
UPDATE public.driver_locations SET latitude=43.0757,longitude=25.6172,position_at=now() WHERE driver_id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
-- Even a mistakenly widened feed policy cannot bypass the acceptance trigger.
DO $$ BEGIN EXECUTE format('CREATE POLICY test_dispatch_guard ON public.taxi_requests FOR ALL TO authenticated USING (id=%L::uuid)',(SELECT request FROM test_ids)); END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status=''accepted'' WHERE id=(SELECT request FROM test_ids)');
RESET ROLE;
DROP POLICY test_dispatch_guard ON public.taxi_requests;

-- Boundary distances use the database's spherical geography, not rounded coordinates.
UPDATE public.driver_locations SET
 latitude=public.st_y(public.st_project(public.st_setsrid(public.st_makepoint(23.3219,42.6977),4326)::public.geography,4900,0)::public.geometry),
 longitude=public.st_x(public.st_project(public.st_setsrid(public.st_makepoint(23.3219,42.6977),4326)::public.geography,4900,0)::public.geometry),position_at=now()
 WHERE driver_id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(true);
UPDATE public.driver_locations SET
 latitude=public.st_y(public.st_project(public.st_setsrid(public.st_makepoint(23.3219,42.6977),4326)::public.geography,5100,0)::public.geometry),position_at=now()
 WHERE driver_id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.driver_locations SET latitude=42.6977,longitude=23.3219,position_at=now() WHERE driver_id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(true);

-- A fresh upload of an old GPS fix must not qualify.
-- The fixture clears the previous timestamp first to exercise this independent condition.
ALTER TABLE public.driver_locations DISABLE TRIGGER guard_location;
UPDATE public.driver_locations SET position_at=now()-interval '46 seconds',updated_at=now() WHERE driver_id=(SELECT driver FROM test_ids);
ALTER TABLE public.driver_locations ENABLE TRIGGER guard_location;
SELECT pg_temp.expect_dispatch(false);
UPDATE public.driver_locations SET position_at=now() WHERE driver_id=(SELECT driver FROM test_ids);
UPDATE public.drivers SET is_online=false WHERE id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.drivers SET is_online=true,is_verified=false WHERE id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.drivers SET is_verified=true,vehicle_id=NULL WHERE id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.drivers SET vehicle_id=(SELECT vehicle FROM test_ids) WHERE id=(SELECT driver FROM test_ids);
UPDATE public.vehicles SET is_active=false WHERE id=(SELECT vehicle FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.vehicles SET is_active=true WHERE id=(SELECT vehicle FROM test_ids);
UPDATE public.vehicles SET vehicle_type_id=NULL WHERE id=(SELECT vehicle FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.vehicles SET vehicle_type_id=(SELECT vehicle_type FROM test_ids) WHERE id=(SELECT vehicle FROM test_ids);
UPDATE public.vehicle_types SET is_active=false WHERE id=(SELECT vehicle_type FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.vehicle_types SET is_active=true WHERE id=(SELECT vehicle_type FROM test_ids);
INSERT INTO public.companies(id,name,slug) VALUES(gen_random_uuid(),'Other test company','other-test-'||gen_random_uuid());
UPDATE public.drivers SET company_id=(SELECT id FROM public.companies WHERE name='Other test company' ORDER BY created_at DESC LIMIT 1)
 WHERE id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.drivers SET company_id=(SELECT company FROM test_ids) WHERE id=(SELECT driver FROM test_ids);
UPDATE public.profiles SET is_active=false WHERE id=(SELECT driver_user FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.profiles SET is_active=true WHERE id=(SELECT driver_user FROM test_ids);
UPDATE public.companies SET is_active=false WHERE id=(SELECT company FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.companies SET is_active=true WHERE id=(SELECT company FROM test_ids);
SELECT pg_temp.expect_dispatch(true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT * FROM public.request_push_recipients((SELECT request FROM test_ids))');
UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status='accepted' WHERE id=(SELECT request FROM test_ids);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT status FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids))<>'accepted' THEN RAISE EXCEPTION 'FAIL nearby acceptance'; END IF;
 IF EXISTS(SELECT 1 FROM public.request_push_recipients((SELECT request FROM test_ids))) THEN RAISE EXCEPTION 'FAIL push after acceptance'; END IF;
END $$;
-- An assigned ride remains readable even when GPS stops; it must not disappear.
UPDATE public.drivers SET is_online=false WHERE id=(SELECT driver FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids) AND status='accepted')
 THEN RAISE EXCEPTION 'FAIL active ride lost after going offline'; END IF; END $$;
RESET ROLE;

-- One endpoint, one active owner; other devices survive account transfer.
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.register_push_subscription('https://fcm.googleapis.com/fixture-shared-'||(SELECT company FROM test_ids),repeat('x',88),repeat('y',22));
SELECT public.register_push_subscription('https://fcm.googleapis.com/fixture-other-'||(SELECT company FROM test_ids),repeat('x',88),repeat('y',22));
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SELECT public.register_push_subscription('https://fcm.googleapis.com/fixture-shared-'||(SELECT company FROM test_ids),repeat('x',88),repeat('y',22));
SELECT pg_temp.must_fail('INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth) VALUES(auth.uid(),''https://fcm.googleapis.com/forged'',''x'',''y'')');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.push_subscriptions WHERE endpoint='https://fcm.googleapis.com/fixture-shared-'||(SELECT company FROM test_ids) AND is_active)<>1
 OR NOT EXISTS(SELECT 1 FROM public.push_subscriptions WHERE endpoint='https://fcm.googleapis.com/fixture-shared-'||(SELECT company FROM test_ids) AND user_id=(SELECT other_customer FROM test_ids) AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.push_subscriptions WHERE endpoint='https://fcm.googleapis.com/fixture-other-'||(SELECT company FROM test_ids) AND user_id=(SELECT customer FROM test_ids) AND is_active)
 THEN RAISE EXCEPTION 'FAIL subscription ownership/device isolation'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.must_fail('SELECT public.register_push_subscription(''https://fcm.googleapis.com/anonymous'',repeat(''x'',88),repeat(''y'',22))');
RESET ROLE;
SELECT 'PASS: cash-only, quote-only, geography, GPS freshness, vehicle/account availability, acceptance guard, push audience and endpoint ownership' AS result;
