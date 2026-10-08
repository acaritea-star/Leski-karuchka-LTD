-- Run after core.sql inside a rollback-only transaction.
RESET ROLE;
INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method) SELECT driver_user,'2026-10-08-draft.3','2026-10-08.1',repeat('a',64),'continue' FROM test_ids ON CONFLICT DO NOTHING;
CREATE TEMP TABLE evidence_ids AS SELECT gen_random_uuid() request,gen_random_uuid() batch,gen_random_uuid() admin;
GRANT SELECT ON evidence_ids TO authenticated;
INSERT INTO auth.users(id,email) SELECT admin,'evidence-'||admin||'@example.invalid' FROM evidence_ids;
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT company FROM test_ids) WHERE id=(SELECT admin FROM evidence_ids);
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price,estimated_distance_km)
SELECT e.request,t.company,t.customer,t.driver,t.vehicle_type,43.2,25.6,'Synthetic',43.205,25.6,'Synthetic','in_progress',now()-interval '5 minutes',now()-interval '2 minutes',15,2 FROM test_ids t CROSS JOIN evidence_ids e;
DELETE FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT driver,company,43.2,25.6,10,now()-interval '55 seconds' FROM test_ids;
UPDATE public.driver_locations SET latitude=43.201,position_at=now()-interval '40 seconds' WHERE driver_id=(SELECT driver FROM test_ids);
-- Duplicate position is a heartbeat, not another sample or distance segment.
UPDATE public.driver_locations SET latitude=43.201,position_at=now()-interval '40 seconds' WHERE driver_id=(SELECT driver FROM test_ids);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=(SELECT request FROM evidence_ids) AND samples=2 AND good_samples=2 AND trip_meters BETWEEN 110 AND 112 AND observed_seconds=15) THEN RAISE EXCEPTION 'FAIL observed distance / duplicate sample'; END IF;
END $$;
UPDATE public.driver_locations SET latitude=42.6,position_at=now()-interval '25 seconds' WHERE driver_id=(SELECT driver FROM test_ids);
UPDATE public.driver_locations SET latitude=43.202,accuracy=500,position_at=now()-interval '10 seconds' WHERE driver_id=(SELECT driver FROM test_ids);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=(SELECT request FROM evidence_ids) AND samples=4 AND good_samples=2 AND trip_meters BETWEEN 110 AND 112 AND flags @> ARRAY['gps_jump','poor_accuracy']) THEN RAISE EXCEPTION 'FAIL poor/jumping GPS counted as distance'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.confirm_ride_start(request) FROM evidence_ids');
SELECT pg_temp.must_fail('UPDATE public.ride_evidence SET flags=''{}'' WHERE request_id=(SELECT request FROM evidence_ids)');
SELECT pg_temp.must_fail('DELETE FROM private.ride_location_samples');
SELECT pg_temp.must_fail('SELECT public.operational_health(company) FROM test_ids');
SELECT pg_temp.must_fail('SELECT public.reserve_route_request_v2(customer,NULL,true,43.2,25.6,43.3,25.7,NULL,company) FROM test_ids');
DO $$ BEGIN IF jsonb_array_length(public.ride_observations((SELECT request FROM evidence_ids)))<>4 THEN RAISE EXCEPTION 'FAIL owner trace access'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.confirm_ride_start(request) FROM evidence_ids');
SELECT pg_temp.must_fail('SELECT public.ride_observations(request) FROM evidence_ids');
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=(SELECT request FROM evidence_ids)) THEN RAISE EXCEPTION 'FAIL cross-customer evidence'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE a timestamptz; b timestamptz; BEGIN
 a:=public.confirm_ride_start((SELECT request FROM evidence_ids));b:=public.confirm_ride_start((SELECT request FROM evidence_ids));
 IF a IS NULL OR a<>b THEN RAISE EXCEPTION 'FAIL confirmation idempotency'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='completed',final_price=999 WHERE id=(SELECT request FROM evidence_ids);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=(SELECT request FROM evidence_ids) AND customer_confirmed_at IS NOT NULL AND flags @> ARRAY['completed_gps_unavailable']) THEN RAISE EXCEPTION 'FAIL stale GPS completion flag'; END IF;
 IF (SELECT final_price FROM public.taxi_requests WHERE id=(SELECT request FROM evidence_ids))<>15 THEN RAISE EXCEPTION 'FAIL observations changed fare'; END IF;
END $$;
SELECT public.record_operation_metrics(batch,'[{"name":"gps.write","outcome":"timeout","count":3,"totalMs":30000,"maxMs":10000}]') FROM evidence_ids;
SELECT public.record_operation_metrics(batch,'[{"name":"gps.write","outcome":"timeout","count":3,"totalMs":30000,"maxMs":10000}]') FROM evidence_ids;
DO $$ BEGIN IF public.record_operation_metrics(gen_random_uuid(),'[{"name":"gps.write","outcome":"ok","count":1,"totalMs":1,"maxMs":1}]') THEN RAISE EXCEPTION 'FAIL metric rate limit'; END IF; END $$;
SELECT pg_temp.must_fail($q$SELECT public.record_operation_metrics(gen_random_uuid(),'[{"name":"gps.write","outcome":"ok","count":1,"totalMs":1,"maxMs":1,"location":"private"}]')$q$);
SELECT pg_temp.must_fail($q$SELECT public.record_operation_metrics(gen_random_uuid(),'[{"name":"untrusted","outcome":"ok","count":1,"totalMs":1,"maxMs":1}]')$q$);
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',admin,'role','authenticated')::text,true) FROM evidence_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE report jsonb; health jsonb; BEGIN
 health:=public.operational_health((SELECT company FROM test_ids));
 IF (health#>>'{metrics,0,count}')::int<>3 OR health->'route_budget'<>'null'::jsonb THEN RAISE EXCEPTION 'FAIL metric retry or budget scope %',health; END IF;
 report:=public.accounting_report((now() AT TIME ZONE 'Europe/Sofia')::date,(now() AT TIME ZONE 'Europe/Sofia')::date+1,(SELECT company FROM test_ids));
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'outcomes') o WHERE o->>'request_id'=(SELECT request::text FROM evidence_ids) AND o#>>'{evidence,customer_confirmed_at}' IS NOT NULL) THEN RAISE EXCEPTION 'FAIL report evidence join'; END IF;
END $$;
RESET ROLE;
UPDATE private.ride_location_samples SET received_at=clock_timestamp()-interval '8 days' WHERE request_id=(SELECT request FROM evidence_ids);
SELECT private.prune_ride_observations();
DO $$ BEGIN IF EXISTS(SELECT 1 FROM private.ride_location_samples WHERE request_id=(SELECT request FROM evidence_ids)) OR NOT EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=(SELECT request FROM evidence_ids)) THEN RAISE EXCEPTION 'FAIL retention / summary preservation'; END IF; END $$;
SET LOCAL ROLE anon;
SELECT pg_temp.must_fail('SELECT * FROM public.ride_evidence');
SELECT pg_temp.must_fail('SELECT public.confirm_ride_start(gen_random_uuid())');
SELECT pg_temp.must_fail('SELECT public.operational_health(gen_random_uuid())');
RESET ROLE;
SELECT 'PASS: ride observations, anomaly exclusion, timestamp deduplication, independent confirmation, accounting, telemetry idempotency/rate/privacy, retention and access isolation' result;

RESET ROLE;
UPDATE private.route_budget_usage SET hits=0 WHERE budget_day=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date AND bucket='global';
DO $$ DECLARE result jsonb; BEGIN
 SELECT public.reserve_route_request_v2(customer,NULL,true,43.2,25.6,43.3,25.7,NULL,company) INTO result FROM test_ids;
 IF result->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL v2 route reservation %',result; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.company_route_usage WHERE company_id=(SELECT company FROM test_ids) AND quoted AND reserved=1 AND denied=0) THEN RAISE EXCEPTION 'FAIL company route counter'; END IF;
END $$;
SELECT 'PASS: company route counters and service-only reservation' result;
