-- Standalone, rollback-only workload. Do not include in the sequential run.sql.
-- __DRIVERS__, __WORKER__ and __MODE__ are bounded by scripts/scale-smoke.mjs.
-- Uses SQL only: pg_net queue entries are rolled back before they can be sent.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SET LOCAL application_name='leski-scale-smoke';
CREATE TEMP TABLE scale_ids AS
 SELECT i,gen_random_uuid() customer,gen_random_uuid() driver_user,
 gen_random_uuid() vehicle,gen_random_uuid() driver
 FROM generate_series(1,__DRIVERS__) i;
CREATE TEMP TABLE scale_run AS SELECT gen_random_uuid() company,gen_random_uuid() vehicle_type,
 clock_timestamp() started_at,pg_backend_pid() session_pid;
CREATE TEMP TABLE scale_timings(stage text,ms double precision);
GRANT SELECT ON scale_ids,scale_run TO authenticated;
INSERT INTO public.companies(id,name,slug)
 SELECT company,'Scale smoke fixture','scale-smoke-'||company FROM scale_run;
INSERT INTO public.vehicle_types(id,company_id,name)
 SELECT vehicle_type,company,'Scale smoke fixture' FROM scale_run;
INSERT INTO auth.users(id,email)
 SELECT customer,'scale-smoke-'||customer||'@example.invalid' FROM scale_ids
 UNION ALL SELECT driver_user,'scale-smoke-'||driver_user||'@example.invalid' FROM scale_ids;
UPDATE public.profiles SET company_id=(SELECT company FROM scale_run)
 WHERE id IN (SELECT customer FROM scale_ids);
UPDATE public.profiles SET company_id=(SELECT company FROM scale_run),role='DRIVER'
 WHERE id IN (SELECT driver_user FROM scale_ids);
UPDATE scale_ids s SET driver=d.id FROM public.drivers d WHERE d.user_id=s.driver_user;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT s.vehicle,r.company,r.vehicle_type,'Scale','Fixture','TEST-'||s.vehicle
 FROM scale_ids s CROSS JOIN scale_run r;
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT s.driver,r.company,43.2+s.i*.000001,25.6,10,clock_timestamp()
 FROM scale_ids s CROSS JOIN scale_run r;
UPDATE public.drivers d SET document_verification_required=false
 FROM scale_ids s WHERE d.id=s.driver;
UPDATE public.drivers d SET is_verified=true,is_online=true,vehicle_id=s.vehicle
 FROM scale_ids s WHERE d.id=s.driver;
-- A short overlap window makes concurrent sessions observable, not a benchmark delay.
SELECT pg_sleep(0.15);
DO $test$
DECLARE s record;r record;n integer;k integer;q uuid;request uuid;result public.taxi_requests;
 t timestamptz;preview jsonb;visible_count integer;other uuid;
BEGIN
 SELECT * INTO r FROM scale_run;
 FOR s IN SELECT * FROM scale_ids ORDER BY i LIMIT 5 LOOP
  PERFORM set_config('request.jwt.claims',json_build_object('sub',s.customer,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  t:=clock_timestamp();preview:=public.nearby_cars(43.2,25.6,r.vehicle_type);
  RESET ROLE;
  INSERT INTO scale_timings VALUES('nearby_read',extract(epoch FROM clock_timestamp()-t)*1000);
  IF jsonb_array_length(preview->'cars')<>least(__DRIVERS__,12) THEN RAISE EXCEPTION 'FAIL eligible preview count'; END IF;
  IF preview->'cars'->0 ? 'driver_id' THEN RAISE EXCEPTION 'FAIL nearby identity disclosure'; END IF;
 END LOOP;
 IF '__MODE__'='lifecycle' THEN
  FOR s IN SELECT * FROM scale_ids ORDER BY i LIMIT 5 LOOP
   -- The actual upsert path, one driver identity and at most one row per fix.
   PERFORM set_config('request.jwt.claims',json_build_object('sub',s.driver_user,'role','authenticated')::text,true);
   FOR k IN 1..20 LOOP
    SET LOCAL ROLE authenticated;
    t:=clock_timestamp();
    INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
     VALUES(s.driver,r.company,43.2+k*.000001,25.6,10,clock_timestamp())
     ON CONFLICT(driver_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
      accuracy=EXCLUDED.accuracy,position_at=EXCLUDED.position_at;
    RESET ROLE;
    INSERT INTO scale_timings VALUES('gps_upsert',extract(epoch FROM clock_timestamp()-t)*1000);
   END LOOP;
   FOR n IN 1..3 LOOP
    q:=gen_random_uuid();request:=gen_random_uuid();
    INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
     VALUES(q,s.customer,r.company,r.vehicle_type,
      '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Scale smoke fixture","destination_address":"Scale smoke fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}');
    PERFORM set_config('request.jwt.claims',json_build_object('sub',s.customer,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    t:=clock_timestamp();result:=public.create_taxi_request(q,request,'cash');
    IF (public.create_taxi_request(q,request,'cash')).id<>request THEN RAISE EXCEPTION 'FAIL create retry'; END IF;
    RESET ROLE;
    INSERT INTO scale_timings VALUES('create_and_retry',extract(epoch FROM clock_timestamp()-t)*1000);
    PERFORM set_config('request.jwt.claims',json_build_object('sub',s.driver_user,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    t:=clock_timestamp();result:=public.accept_taxi_request(request);
    IF (public.accept_taxi_request(request)).driver_id<>s.driver THEN RAISE EXCEPTION 'FAIL accept retry'; END IF;
    RESET ROLE;
    INSERT INTO scale_timings VALUES('accept_and_retry',extract(epoch FROM clock_timestamp()-t)*1000);
    -- Another customer's RLS view must never include this ride.
    SELECT customer INTO other FROM scale_ids WHERE i<>s.i ORDER BY i LIMIT 1;
    PERFORM set_config('request.jwt.claims',json_build_object('sub',other,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO visible_count FROM public.taxi_requests WHERE id=request;
    RESET ROLE;
    IF visible_count<>0 THEN RAISE EXCEPTION 'FAIL customer isolation'; END IF;
    IF n=2 THEN
     PERFORM set_config('request.jwt.claims',json_build_object('sub',s.customer,'role','authenticated')::text,true);
     SET LOCAL ROLE authenticated;
     UPDATE public.taxi_requests SET status='cancelled',cancel_reason='scale_fixture' WHERE id=request;
     RESET ROLE;
     IF EXISTS(SELECT 1 FROM public.trips WHERE request_id=request) THEN RAISE EXCEPTION 'FAIL cancelled trip counted'; END IF;
    ELSE
     PERFORM set_config('request.jwt.claims',json_build_object('sub',s.driver_user,'role','authenticated')::text,true);
     SET LOCAL ROLE authenticated;
     t:=clock_timestamp();
     UPDATE public.taxi_requests SET status='arrived' WHERE id=request;
     UPDATE public.taxi_requests SET status='in_progress' WHERE id=request;
     UPDATE public.taxi_requests SET status='completed',final_price=99999 WHERE id=request;
     RESET ROLE;
     INSERT INTO scale_timings VALUES('finish_lifecycle',extract(epoch FROM clock_timestamp()-t)*1000);
     IF (SELECT count(*) FROM public.trips WHERE request_id=request)<>1
       OR (SELECT final_price FROM public.taxi_requests WHERE id=request)<>5 THEN
      RAISE EXCEPTION 'FAIL unique completion or protected price'; END IF;
    END IF;
    IF (SELECT count(*) FROM public.request_outcomes WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'FAIL outcome cardinality'; END IF;
   END LOOP;
  END LOOP;
  IF (SELECT count(*) FROM public.taxi_requests WHERE company_id=r.company AND status='completed')<>10
    OR (SELECT count(*) FROM public.taxi_requests WHERE company_id=r.company AND status='cancelled')<>5
    OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE company_id=r.company AND status IN ('pending','accepted','arrived','in_progress'))
    OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=r.company) THEN
   RAISE EXCEPTION 'FAIL terminal states or synthetic money'; END IF;
 END IF;
END $test$;
SELECT jsonb_build_object('worker',__WORKER__,'mode','__MODE__','drivers',__DRIVERS__,
 'session_pid',(SELECT session_pid FROM scale_run),'started_at',(SELECT started_at FROM scale_run),
 'finished_at',clock_timestamp(),'other_test_sessions',(SELECT count(*) FROM pg_stat_activity
  WHERE application_name='leski-scale-smoke' AND pid<>pg_backend_pid() AND state='active'),
 'timings',(SELECT jsonb_object_agg(stage,metrics) FROM (
  SELECT stage,jsonb_build_object('count',count(*),'avg_ms',round(avg(ms)::numeric,3),
   'p95_ms',round(percentile_cont(.95) WITHIN GROUP(ORDER BY ms)::numeric,3),'max_ms',round(max(ms)::numeric,3)) metrics
  FROM scale_timings GROUP BY stage) measured),'passed',true) AS result;
ROLLBACK;
