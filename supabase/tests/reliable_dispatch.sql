-- Follows core.sql and cash_geo_push.sql. Always execute inside BEGIN/ROLLBACK.
RESET ROLE;
UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system'
  WHERE id=(SELECT request FROM test_ids);
UPDATE test_ids SET quote=gen_random_uuid(),request=gen_random_uuid();
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
UPDATE public.driver_locations SET latitude=42.6977,longitude=23.3219,accuracy=10,position_at=clock_timestamp()
  WHERE driver_id=(SELECT driver FROM test_ids);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
  SELECT quote,customer,company,vehicle_type,
  '{"pickup_latitude":42.6977,"pickup_longitude":23.3219,"destination_latitude":42.70,"destination_longitude":23.33,"pickup_address":"Dispatch fixture","destination_address":"Destination fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT pg_temp.must_fail('SELECT * FROM private.push_outbox');
SELECT pg_temp.must_fail('SELECT public.claim_push_job(gen_random_uuid(),gen_random_uuid())');
SELECT pg_temp.must_fail('SELECT public.finish_push_job(gen_random_uuid(),gen_random_uuid(),''sent'')');
RESET ROLE;

DO $$ BEGIN
  IF (SELECT count(*) FROM private.push_outbox WHERE request_id=(SELECT request FROM test_ids)
    AND event_type='new_request' AND recipient_id=(SELECT driver_user FROM test_ids))<>1 THEN
    RAISE EXCEPTION 'FAIL atomic/idempotent outbox event'; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE data->>'request_id'=(SELECT request::text FROM test_ids)
    AND type='new_request' AND user_id=(SELECT driver_user FROM test_ids))<>1 THEN
    RAISE EXCEPTION 'FAIL atomic/idempotent in-app notification'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)
    AND expires_at>created_at+interval '119 seconds' AND expires_at<created_at+interval '125 seconds') THEN
    RAISE EXCEPTION 'FAIL server deadline'; END IF;
END $$;

-- Possession of a guessed or expired token never authenticates a job.
DO $$ DECLARE j private.push_outbox; BEGIN
  SELECT * INTO j FROM private.push_outbox WHERE request_id=(SELECT request FROM test_ids) AND event_type='new_request';
  IF public.claim_push_job(j.id,gen_random_uuid()) IS NOT NULL THEN RAISE EXCEPTION 'FAIL wrong capability accepted'; END IF;
  UPDATE private.push_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE id=j.id;
  IF public.claim_push_job(j.id,j.lease_token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL expired lease accepted'; END IF;
END $$;
SELECT private.dispatch_push_outbox()>=1 AS reclaimed;
-- GPS can change between commit and delivery: the worker rechecks it.
UPDATE public.driver_locations SET latitude=43.4170,longitude=24.6067,position_at=clock_timestamp()
  WHERE driver_id=(SELECT driver FROM test_ids);
DO $$ DECLARE j private.push_outbox; BEGIN
  SELECT * INTO j FROM private.push_outbox WHERE request_id=(SELECT request FROM test_ids) AND event_type='new_request';
  IF public.claim_push_job(j.id,j.lease_token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL moved driver received job'; END IF;
  IF (SELECT status FROM private.push_outbox WHERE id=j.id)<>'skipped' THEN RAISE EXCEPTION 'FAIL obsolete job not skipped'; END IF;
END $$;
UPDATE public.driver_locations SET latitude=42.6977,longitude=23.3219,accuracy=101,position_at=clock_timestamp()
  WHERE driver_id=(SELECT driver FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
UPDATE public.driver_locations SET accuracy=10,position_at=clock_timestamp() WHERE driver_id=(SELECT driver FROM test_ids);

-- Close a pending order's deadline while retaining its row. Both old UPDATE
-- clients and the new RPC must fail; a widened RLS policy cannot bypass time.
UPDATE public.taxi_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=(SELECT request FROM test_ids);
SELECT pg_temp.expect_dispatch(false);
DO $$ BEGIN EXECUTE format('CREATE POLICY test_expiry_guard ON public.taxi_requests FOR ALL TO authenticated USING (id=%L::uuid)',(SELECT request FROM test_ids)); END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.accept_taxi_request((SELECT request FROM test_ids))');
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET driver_id=(SELECT driver FROM test_ids),status=''accepted'' WHERE id=(SELECT request FROM test_ids)');
SELECT pg_temp.must_fail('INSERT INTO public.notifications(user_id,company_id,title) SELECT other_customer,company,''Forged'' FROM test_ids');
SELECT pg_temp.must_fail('INSERT INTO public.driver_documents(driver_id,company_id,type) SELECT driver,(SELECT id FROM public.companies WHERE name=''Other test company'' ORDER BY created_at DESC LIMIT 1),''license'' FROM test_ids');
-- Document registration now requires the reviewed upload RPC; a raw INSERT
-- must stay forbidden even within the driver's own company.
SELECT pg_temp.must_fail('INSERT INTO public.driver_documents(driver_id,company_id,type) SELECT driver,company,''license'' FROM test_ids');
RESET ROLE;
DROP POLICY test_expiry_guard ON public.taxi_requests;
SELECT public.expire_stale_requests();
SELECT public.expire_stale_requests();
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids) AND status='cancelled' AND cancel_reason='no_driver') THEN
    RAISE EXCEPTION 'FAIL expiration'; END IF;
  IF (SELECT count(*) FROM public.notifications WHERE data->>'request_id'=(SELECT request::text FROM test_ids)
    AND type='no_driver' AND user_id=(SELECT customer FROM test_ids))<>1 THEN
    RAISE EXCEPTION 'FAIL duplicate timeout notification'; END IF;
END $$;

-- Driver privacy: an unrelated customer cannot enumerate driver records.
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.drivers WHERE id=(SELECT driver FROM test_ids)) THEN RAISE EXCEPTION 'FAIL unrelated driver privacy'; END IF;
END $$;
SELECT pg_temp.must_fail('SELECT public.wake_request_push((SELECT request FROM test_ids))');
RESET ROLE;

-- A valid lease is single use; a transient failure becomes a durable retry.
CREATE TEMP TABLE test_push_cap AS SELECT id,lease_token FROM private.push_outbox
  WHERE request_id=(SELECT request FROM test_ids) AND event_type='cancelled';
GRANT SELECT ON test_push_cap TO service_role;
SET LOCAL ROLE service_role;
DO $$ DECLARE j record; BEGIN
  SELECT * INTO j FROM test_push_cap;
  IF public.claim_push_job(j.id,j.lease_token) IS NULL THEN RAISE EXCEPTION 'FAIL valid worker capability'; END IF;
  IF public.claim_push_job(j.id,j.lease_token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL replayed claim'; END IF;
  IF NOT public.finish_push_job(j.id,j.lease_token,'retry','PROVIDER_TRANSIENT') THEN RAISE EXCEPTION 'FAIL retry acknowledgement'; END IF;
  IF public.finish_push_job(j.id,j.lease_token,'sent') THEN RAISE EXCEPTION 'FAIL stale finish changed job'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM private.push_outbox WHERE id=(SELECT id FROM test_push_cap)
    AND status='pending' AND available_at>clock_timestamp() AND lease_token IS NULL) THEN
    RAISE EXCEPTION 'FAIL durable retry'; END IF;
END $$;

-- Recover an abandoned processing lease, but never retry more than five times.
UPDATE private.push_outbox SET status='processing',attempts=5,lease_until=clock_timestamp()-interval '1 second'
  WHERE id=(SELECT id FROM test_push_cap);
SELECT private.dispatch_push_outbox();
DO $$ BEGIN
  IF (SELECT status FROM private.push_outbox WHERE id=(SELECT id FROM test_push_cap))<>'failed' THEN
    RAISE EXCEPTION 'FAIL retry limit'; END IF;
END $$;

-- Accept RPC is idempotent and creates a single customer event.
UPDATE test_ids SET quote=gen_random_uuid(),request=gen_random_uuid();
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
  SELECT quote,customer,company,vehicle_type,
  '{"pickup_latitude":42.6977,"pickup_longitude":23.3219,"destination_latitude":42.70,"destination_longitude":23.33,"pickup_address":"Accept fixture","destination_address":"Destination fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SELECT public.accept_taxi_request(request) IS NOT NULL FROM test_ids;
SELECT public.accept_taxi_request(request) IS NOT NULL FROM test_ids;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM private.push_outbox WHERE request_id=(SELECT request FROM test_ids)
    AND event_type='accepted' AND recipient_id=(SELECT customer FROM test_ids))<>1 THEN
    RAISE EXCEPTION 'FAIL duplicate accepted event'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=(SELECT driver FROM test_ids)) THEN
    RAISE EXCEPTION 'FAIL assigned driver hidden from customer'; END IF;
END $$;
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET expires_at=clock_timestamp()+interval ''1 day'' WHERE id=(SELECT request FROM test_ids)');
RESET ROLE;
SELECT 'PASS: deadlines, GPS accuracy, atomic events, lease authentication/replay, retry recovery/limit, driver privacy and accept RPC idempotency' AS result;
