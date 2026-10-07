-- Run inside BEGIN/ROLLBACK (run.sql). All users, rides and counter changes
-- are synthetic and never survive the transaction. No Google request occurs.
CREATE TEMP TABLE route_test_ids AS SELECT gen_random_uuid() customer,gen_random_uuid() driver_user,
 gen_random_uuid() stranger,gen_random_uuid() other_customer,gen_random_uuid() company,
 gen_random_uuid() vehicle_type,gen_random_uuid() vehicle,gen_random_uuid() quote,gen_random_uuid() request;
GRANT SELECT ON route_test_ids TO authenticated;
INSERT INTO public.companies(id,name,slug) SELECT company,'Route budget test','route-budget-'||company FROM route_test_ids;
INSERT INTO auth.users(id,email) SELECT customer,'route-budget-'||customer||'@example.invalid' FROM route_test_ids;
INSERT INTO auth.users(id,email) SELECT driver_user,'route-budget-'||driver_user||'@example.invalid' FROM route_test_ids;
INSERT INTO auth.users(id,email) SELECT stranger,'route-budget-'||stranger||'@example.invalid' FROM route_test_ids;
INSERT INTO auth.users(id,email) SELECT other_customer,'route-budget-'||other_customer||'@example.invalid' FROM route_test_ids;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT vehicle_type,company,'Test car' FROM route_test_ids;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number) SELECT vehicle,company,vehicle_type,'Test','Test','ROUTE-'||left(vehicle::text,8) FROM route_test_ids;
UPDATE public.profiles SET company_id=(SELECT company FROM route_test_ids),role='DRIVER' WHERE id=(SELECT driver_user FROM route_test_ids);
UPDATE public.drivers SET document_verification_required=false FROM route_test_ids) WHERE user_id=(SELECT driver_user FROM route_test_ids);
UPDATE public.drivers SET is_verified=true,vehicle_id=(SELECT vehicle FROM route_test_ids) WHERE user_id=(SELECT driver_user FROM route_test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT d.id,t.company,43.2,25.6,8,clock_timestamp() FROM route_test_ids t JOIN public.drivers d ON d.user_id=t.driver_user;
UPDATE public.drivers SET is_online=true WHERE user_id=(SELECT driver_user FROM route_test_ids);
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company,vehicle_type,'{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.3,"destination_longitude":25.7,"pickup_address":"Test pickup","destination_address":"Test destination","distance_km":12,"duration_min":20,"total":15,"breakdown":{"total":15}}'::jsonb FROM route_test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM route_test_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,request,'cash') FROM route_test_ids;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM route_test_ids;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT driver_user FROM route_test_ids)),status='accepted' WHERE id=(SELECT request FROM route_test_ids);
RESET ROLE;

DO $$ DECLARE ids record; reply jsonb; before_hits integer; day_key date:=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date; BEGIN
 SELECT * INTO ids FROM route_test_ids;
 IF has_function_privilege('anon','public.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text)','EXECUTE') THEN RAISE EXCEPTION 'FAIL route RPC grants'; END IF;
 IF has_table_privilege('authenticated','private.route_budget_usage','SELECT') OR has_table_privilege('anon','private.route_budget_settings','SELECT') THEN RAISE EXCEPTION 'FAIL private budget exposure'; END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname IN ('route_budget_settings','route_budget_usage') AND c.relrowsecurity)<>2 THEN RAISE EXCEPTION 'FAIL budget RLS'; END IF;
 DELETE FROM private.route_budget_usage;
 UPDATE private.route_budget_settings SET ride_limit=2;
 reply:=public.reserve_route_request(ids.stranger,ids.request,false,43.2,25.6,43.2,25.6,'pickup');
 IF reply->>'code'<>'ROUTE_ACCESS_DENIED' THEN RAISE EXCEPTION 'FAIL foreign ride'; END IF;
 reply:=public.reserve_route_request(ids.customer,ids.request,false,43.2,25.6,43.3,25.7,'destination');
 IF reply->>'code'<>'INVALID_ROUTE_CONTEXT' THEN RAISE EXCEPTION 'FAIL destination before start'; END IF;
 reply:=public.reserve_route_request(ids.customer,NULL,true,43.2,25.6,43.3,25.7,NULL);
 IF reply->>'code'<>'ACTIVE_REQUEST_EXISTS' THEN RAISE EXCEPTION 'FAIL quote bypass while active'; END IF;
 IF EXISTS(SELECT 1 FROM private.route_budget_usage) THEN RAISE EXCEPTION 'FAIL denied request consumed budget'; END IF;
 reply:=public.reserve_route_request(ids.customer,ids.request,false,43.2,25.6,43.3,25.7,'context');
 IF reply->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL planned context'; END IF;
 reply:=public.reserve_route_request(ids.driver_user,NULL,false,43.199,25.6,43.2,25.6,NULL);
 IF reply->>'allowed'<>'true' OR reply->>'request_id'<>ids.request::text THEN RAISE EXCEPTION 'FAIL legacy driver inference'; END IF;
 reply:=public.reserve_route_request(ids.customer,ids.request,false,43.199,25.6,43.2,25.6,'pickup');
 IF reply->>'code'<>'ROUTE_RIDE_LIMIT' THEN RAISE EXCEPTION 'FAIL shared rider/driver limit'; END IF;
 reply:=public.reserve_route_request(ids.driver_user,NULL,false,43.199,25.6,43.2,25.6,NULL);
 IF reply->>'code'<>'ROUTE_RIDE_LIMIT' THEN RAISE EXCEPTION 'FAIL omitted ID bypass'; END IF;
 SELECT hits INTO before_hits FROM private.route_budget_usage WHERE bucket='global' AND budget_day=day_key;
 IF before_hits<>2 THEN RAISE EXCEPTION 'FAIL rejected operation consumed global budget'; END IF;
 UPDATE private.route_budget_settings SET daily_limit=6,quote_reserve=2,user_daily_limit=3,ride_limit=10;
 DELETE FROM private.route_budget_usage;
 FOR i IN 1..3 LOOP
  reply:=public.reserve_route_request(ids.stranger,NULL,false,43.2,25.6,43.3,25.7,NULL);
  IF reply->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL preview below user limit'; END IF;
 END LOOP;
 reply:=public.reserve_route_request(ids.stranger,NULL,false,43.2,25.6,43.3,25.7,NULL);
 IF reply->>'code'<>'ROUTE_USER_LIMIT' THEN RAISE EXCEPTION 'FAIL user daily limit'; END IF;
 UPDATE private.route_budget_settings SET user_daily_limit=6;
 DELETE FROM private.route_budget_usage;
 FOR i IN 1..4 LOOP
  reply:=public.reserve_route_request(ids.stranger,NULL,false,43.2,25.6,43.3,25.7,NULL);
  IF reply->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL preview below reserve'; END IF;
 END LOOP;
 reply:=public.reserve_route_request(ids.other_customer,NULL,false,43.2,25.6,43.3,25.7,NULL);
 IF reply->>'code'<>'ROUTE_DAILY_LIMIT' THEN RAISE EXCEPTION 'FAIL quote reserve'; END IF;
 FOR i IN 1..2 LOOP
  reply:=public.reserve_route_request(ids.stranger,NULL,true,43.2,25.6,43.3,25.7,NULL);
  IF reply->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL reserved quote capacity'; END IF;
 END LOOP;
 reply:=public.reserve_route_request(ids.other_customer,NULL,true,43.2,25.6,43.3,25.7,NULL);
 IF reply->>'code'<>'ROUTE_DAILY_LIMIT' OR (reply->>'retry_after_sec')::integer NOT BETWEEN 1 AND 90000 THEN RAISE EXCEPTION 'FAIL absolute daily limit or reset guidance'; END IF;
 SELECT hits INTO before_hits FROM private.route_budget_usage WHERE bucket='global' AND budget_day=day_key;
 IF before_hits<>6 THEN RAISE EXCEPTION 'FAIL budget exceeded daily ceiling'; END IF;
END $$;

-- Phase changes reuse one ride budget and must not allow the old pickup target.
DELETE FROM private.route_budget_usage;
UPDATE private.route_budget_settings SET daily_limit=120,quote_reserve=20,user_daily_limit=60,ride_limit=10;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT request FROM route_test_ids);
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT request FROM route_test_ids);
RESET ROLE;
DO $$ DECLARE ids record; reply jsonb; BEGIN
 SELECT * INTO ids FROM route_test_ids;
 reply:=public.reserve_route_request(ids.customer,ids.request,false,43.2,25.6,43.2,25.6,'pickup');
 IF reply->>'code'<>'INVALID_ROUTE_CONTEXT' THEN RAISE EXCEPTION 'FAIL old leg after trip start'; END IF;
 reply:=public.reserve_route_request(ids.driver_user,ids.request,false,43.2,25.6,43.3,25.7,'destination');
 IF reply->>'allowed'<>'true' THEN RAISE EXCEPTION 'FAIL active destination'; END IF;
END $$;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='completed' WHERE id=(SELECT request FROM route_test_ids);
RESET ROLE;
DO $$ DECLARE ids record; reply jsonb; BEGIN
 SELECT * INTO ids FROM route_test_ids;
 reply:=public.reserve_route_request(ids.customer,ids.request,false,43.2,25.6,43.3,25.7,'context');
 IF reply->>'code'<>'ROUTE_ACCESS_DENIED' THEN RAISE EXCEPTION 'FAIL closed ride allowed'; END IF;
END $$;
SELECT 'PASS: service-only grants, private RLS, ownership, targets, shared ride limit, legacy client inference, user/day cap, quote reserve, daily cap, lifecycle' AS result;
