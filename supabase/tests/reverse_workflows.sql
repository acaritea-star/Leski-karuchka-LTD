-- Independent rollback-only regression. All identities are synthetic.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
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
UPDATE public.drivers SET document_verification_required=false WHERE id=(SELECT driver FROM test_ids);
UPDATE public.drivers SET is_verified=true,vehicle_id=(SELECT vehicle FROM test_ids),is_online=false WHERE id=(SELECT driver FROM test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT driver,company,43.2,25.6,10,now() FROM test_ids;
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,'{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.3,"destination_longitude":25.7,"pickup_address":"Test pickup","destination_address":"Test destination","distance_km":12,"duration_min":20,"total":15,"breakdown":{"total":15}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SELECT public.accept_taxi_request(request) IS NOT NULL FROM test_ids;
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT request FROM test_ids);
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT request FROM test_ids);
UPDATE public.taxi_requests SET status='completed' WHERE id=(SELECT request FROM test_ids);
RESET ROLE;
RESET ROLE;
CREATE FUNCTION pg_temp.workflow_deny(q text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN; END;
 RAISE EXCEPTION 'FAIL workflow unexpectedly allowed: %',q;
END $fn$;
CREATE FUNCTION pg_temp.workflow_retry(expected text) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE before_row jsonb;after_row jsonb;r public.taxi_requests;
BEGIN
 SELECT to_jsonb(t) INTO before_row FROM public.taxi_requests t WHERE id=(SELECT request FROM test_ids);
 r:=public.accept_taxi_request((SELECT request FROM test_ids));
 IF r.id IS DISTINCT FROM (SELECT request FROM test_ids) OR r.status::text IS DISTINCT FROM expected THEN RAISE EXCEPTION 'FAIL retry returned wrong phase: %',r.status; END IF;
 r:=public.accept_taxi_request((SELECT request FROM test_ids));
 SELECT to_jsonb(t) INTO after_row FROM public.taxi_requests t WHERE id=(SELECT request FROM test_ids);
 IF before_row IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'FAIL retry rewrote ride'; END IF;
END $fn$;
-- The fixture has completed one owned ride. A retry returns it unchanged.
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.workflow_retry('completed');
RESET ROLE;

UPDATE test_ids SET quote=gen_random_uuid(),request=gen_random_uuid();
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,
 '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Workflow test","destination_address":"Workflow destination","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT pg_temp.workflow_deny('INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids');
RESET ROLE;

CREATE TEMP TABLE workflow_foreign AS SELECT gen_random_uuid() company,gen_random_uuid() customer,
 gen_random_uuid() vehicle_type,gen_random_uuid() quote,gen_random_uuid() request,gen_random_uuid() driver_user,gen_random_uuid() vehicle;
GRANT SELECT ON workflow_foreign TO authenticated;
INSERT INTO public.companies(id,name,slug) SELECT company,'Foreign workflow test','workflow-'||company FROM workflow_foreign;
INSERT INTO auth.users(id,email) SELECT customer,'workflow-'||customer||'@example.invalid' FROM workflow_foreign;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT vehicle_type,company,'Foreign test car' FROM workflow_foreign;
-- Give the foreign operator a real eligible synthetic driver so this tests
-- company isolation without relying on creation of an unserviceable booking.
INSERT INTO auth.users(id,email) SELECT driver_user,'workflow-driver-'||driver_user||'@example.invalid' FROM workflow_foreign;
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company FROM workflow_foreign) WHERE id=(SELECT driver_user FROM workflow_foreign);
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT vehicle,company,vehicle_type,'Workflow','Foreign','WF-'||left(vehicle::text,8) FROM workflow_foreign;
UPDATE public.drivers SET document_verification_required=false,is_verified=true,vehicle_id=(SELECT vehicle FROM workflow_foreign) WHERE user_id=(SELECT driver_user FROM workflow_foreign);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT d.id,f.company,43.2,25.6,10,clock_timestamp() FROM workflow_foreign f JOIN public.drivers d ON d.user_id=f.driver_user;
UPDATE public.drivers SET is_online=true WHERE user_id=(SELECT driver_user FROM workflow_foreign);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,
 '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Foreign workflow","destination_address":"Workflow destination","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM workflow_foreign;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM workflow_foreign;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM workflow_foreign;
RESET ROLE;

SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
-- Same coordinates cannot bypass company isolation even with a known UUID.
SELECT pg_temp.workflow_deny('INSERT INTO public.request_declines(request_id,driver_id) SELECT f.request,t.driver FROM workflow_foreign f,test_ids t');
INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids ON CONFLICT(request_id,driver_id) DO NOTHING;
INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids ON CONFLICT(request_id,driver_id) DO NOTHING;
DO $test$ BEGIN
 IF (SELECT count(*) FROM public.request_declines WHERE request_id=(SELECT request FROM test_ids))<>1 THEN RAISE EXCEPTION 'FAIL duplicate refusal'; END IF;
END $test$;
RESET ROLE;
-- An expired UUID must not create refusal records, even before the sweeper runs.
DELETE FROM public.request_declines WHERE request_id=(SELECT request FROM test_ids);
UPDATE public.taxi_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=(SELECT request FROM test_ids);
SET LOCAL ROLE authenticated;
SELECT pg_temp.workflow_deny('INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids');
RESET ROLE;
UPDATE public.taxi_requests SET expires_at=clock_timestamp()+interval '2 minutes' WHERE id=(SELECT request FROM test_ids);
-- An offline driver cannot receive or refuse a pending offer.
UPDATE public.drivers SET is_online=false WHERE id=(SELECT driver FROM test_ids);
SET LOCAL ROLE authenticated;
SELECT pg_temp.workflow_deny('INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids');
SELECT pg_temp.workflow_deny('SELECT public.accept_taxi_request((SELECT request FROM test_ids))');
RESET ROLE;
UPDATE public.driver_locations SET position_at=clock_timestamp() WHERE driver_id=(SELECT driver FROM test_ids);
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
SET LOCAL ROLE authenticated;
SELECT public.accept_taxi_request(request) IS NOT NULL FROM test_ids;
SELECT pg_temp.workflow_retry('accepted');
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT request FROM test_ids);
SELECT pg_temp.workflow_retry('arrived');
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT request FROM test_ids);
SELECT pg_temp.workflow_retry('in_progress');
UPDATE public.taxi_requests SET status='completed',final_price=9999 WHERE id=(SELECT request FROM test_ids);
SELECT pg_temp.workflow_retry('completed');
SELECT pg_temp.workflow_deny('INSERT INTO public.request_declines(request_id,driver_id) SELECT request,driver FROM test_ids');
RESET ROLE;
DO $test$ BEGIN
 IF (SELECT count(*) FROM public.trips WHERE request_id=(SELECT request FROM test_ids))<>1
 OR (SELECT final_price FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids))<>5
 OR (SELECT count(*) FROM public.request_outcomes WHERE request_id=(SELECT request FROM test_ids))<>1
 OR (SELECT count(*) FROM private.push_outbox WHERE request_id=(SELECT request FROM test_ids) AND event_type='accepted')<>1
 THEN RAISE EXCEPTION 'FAIL duplicate financial outcome or event'; END IF;
END $test$;
-- A different customer cannot read an owned terminal ride through this RPC.
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM workflow_foreign;
SET LOCAL ROLE authenticated;
SELECT pg_temp.workflow_deny('SELECT public.accept_taxi_request((SELECT request FROM test_ids))');
RESET ROLE;
-- Cancellation remains terminal: an owned cancelled ride cannot be reaccepted.
UPDATE test_ids SET quote=gen_random_uuid(),request=gen_random_uuid();
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,
 '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Cancel workflow","destination_address":"Workflow destination","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}'::jsonb FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') IS NOT NULL FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SELECT public.accept_taxi_request(request) IS NOT NULL FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
UPDATE public.taxi_requests SET status='cancelled',cancelled_by='customer' WHERE id=(SELECT request FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SELECT pg_temp.workflow_deny('SELECT public.accept_taxi_request((SELECT request FROM test_ids))');
RESET ROLE;
SELECT 'PASS: refusal scope, duplicate INSERT, expiry, offline state, retries across ride phases, one financial outcome and terminal cancellation' AS result;
ROLLBACK;
