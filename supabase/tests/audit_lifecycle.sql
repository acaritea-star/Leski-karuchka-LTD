-- Bounded smoke test, synthetic UUIDs, no DDL, no Google calls, no committed data.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 company uuid:=gen_random_uuid(); vehicle_type uuid:=gen_random_uuid();
 customer uuid; driver_user uuid; driver uuid; vehicle uuid; other_customer uuid:=gen_random_uuid();
 quote uuid; request uuid; result public.taxi_requests; preview jsonb;
 i integer; k integer; n integer; visible_count integer; denied boolean;
 started timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(company,'Audit fixture','audit-fixture-'||company);
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(vehicle_type,company,'Audit fixture');
 INSERT INTO auth.users(id,email) VALUES(other_customer,'audit-'||other_customer||'@example.invalid');
 UPDATE public.profiles SET company_id=company WHERE id=other_customer;
 FOR i IN 1..5 LOOP
  customer:=gen_random_uuid(); driver_user:=gen_random_uuid(); vehicle:=gen_random_uuid();
  INSERT INTO auth.users(id,email) SELECT id,'audit-'||id||'@example.invalid' FROM unnest(ARRAY[customer,driver_user]) s(id);
  UPDATE public.profiles SET company_id=company WHERE id=customer;
  UPDATE public.profiles SET company_id=company,role='DRIVER' WHERE id=driver_user;
  SELECT d.id INTO STRICT driver FROM public.drivers d WHERE d.user_id=driver_user;
  INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
   VALUES(vehicle,company,vehicle_type,'Audit','Fixture','AUDIT-'||vehicle);
  INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
   VALUES(driver,company,43.2,25.6,10,clock_timestamp());
  UPDATE public.drivers SET vehicle_id=vehicle,is_verified=true,is_online=true WHERE id=driver;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
  FOR k IN 1..20 LOOP
   SET LOCAL ROLE authenticated;
   INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
    VALUES(driver,company,43.2+k*.000001,25.6,10,clock_timestamp())
    ON CONFLICT(driver_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
     accuracy=EXCLUDED.accuracy,position_at=EXCLUDED.position_at;
   RESET ROLE;
  END LOOP;
  FOR n IN 1..3 LOOP
   quote:=gen_random_uuid(); request:=gen_random_uuid();
   INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
    VALUES(quote,customer,company,vehicle_type,
     '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Audit fixture","destination_address":"Audit fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}');
   PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   result:=public.create_taxi_request(quote,request,'cash');
   IF result.id<>request OR (public.create_taxi_request(quote,request,'cash')).id<>request THEN RAISE EXCEPTION 'FAIL create/retry identity'; END IF;
   RESET ROLE;
   PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
   -- One request proves that a far-away or expired offer cannot be taken.
   IF i=1 AND n=1 THEN
    SET LOCAL ROLE authenticated;
    UPDATE public.driver_locations SET latitude=42.6977,longitude=23.3219,position_at=clock_timestamp() WHERE driver_id=driver;
    denied:=false;
    BEGIN
     PERFORM public.accept_taxi_request(request);
    EXCEPTION WHEN OTHERS THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL cross-city acceptance'; END IF;
    UPDATE public.driver_locations SET latitude=43.2,longitude=25.6,position_at=clock_timestamp() WHERE driver_id=driver;
    RESET ROLE;
    UPDATE public.taxi_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=request;
    SET LOCAL ROLE authenticated;
    denied:=false;
    BEGIN
     PERFORM public.accept_taxi_request(request);
    EXCEPTION WHEN OTHERS THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL expired acceptance'; END IF;
    RESET ROLE;
    UPDATE public.taxi_requests SET expires_at=clock_timestamp()+interval '2 minutes' WHERE id=request;
   END IF;
   SET LOCAL ROLE authenticated;
   result:=public.accept_taxi_request(request);
   IF result.driver_id<>driver OR (public.accept_taxi_request(request)).driver_id<>driver THEN RAISE EXCEPTION 'FAIL accept/retry identity'; END IF;
   RESET ROLE;
   PERFORM set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   SELECT count(*) INTO visible_count FROM public.taxi_requests WHERE id=request;
   RESET ROLE;
   IF visible_count<>0 THEN RAISE EXCEPTION 'FAIL isolation'; END IF;
   IF n=2 THEN
    PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE public.taxi_requests SET status='cancelled',cancel_reason='audit_fixture' WHERE id=request;
    RESET ROLE;
    IF EXISTS(SELECT 1 FROM public.trips WHERE request_id=request) THEN RAISE EXCEPTION 'FAIL cancelled trip counted'; END IF;
   ELSE
    PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE public.taxi_requests SET status='arrived' WHERE id=request;
    UPDATE public.taxi_requests SET status='in_progress' WHERE id=request;
    UPDATE public.taxi_requests SET status='completed',final_price=99999 WHERE id=request;
    RESET ROLE;
    IF (SELECT count(*) FROM public.trips WHERE request_id=request)<>1
     OR (SELECT final_price FROM public.taxi_requests WHERE id=request)<>5 THEN RAISE EXCEPTION 'FAIL completion integrity'; END IF;
   END IF;
   IF (SELECT count(*) FROM public.request_outcomes WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'FAIL outcome cardinality'; END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 preview:=public.nearby_cars(43.2,25.6,vehicle_type);
 RESET ROLE;
 IF jsonb_array_length(preview->'cars')<>5 THEN RAISE EXCEPTION 'FAIL available car count'; END IF;
 IF preview->'cars'->0 ? 'driver_id' THEN RAISE EXCEPTION 'FAIL nearby identity disclosure'; END IF;
 IF (SELECT count(*) FROM public.taxi_requests WHERE company_id=company AND status='completed')<>10
  OR (SELECT count(*) FROM public.taxi_requests WHERE company_id=company AND status='cancelled')<>5
  OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE company_id=company AND status IN ('pending','accepted','arrived','in_progress'))
  OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=company) THEN RAISE EXCEPTION 'FAIL final accounting'; END IF;
 PERFORM set_config('leski.audit_result',jsonb_build_object('passed',true,'drivers',5,'gps_updates',102,'gps_seed_rows',5,'cross_city_blocked',true,'expired_blocked',true,
  'completed',10,'cancelled',5,'ms',round(extract(epoch FROM clock_timestamp()-started)*1000,2))::text,true);
END $test$;
SELECT current_setting('leski.audit_result')::jsonb AS result;
ROLLBACK;
