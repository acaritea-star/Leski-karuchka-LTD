-- Runs after core.sql in a rollback transaction; no real users or outbound APIs.
RESET ROLE;
CREATE TEMP TABLE unavailable_type AS SELECT gen_random_uuid() id;
GRANT SELECT ON unavailable_type TO authenticated;
INSERT INTO public.vehicle_types(id,company_id,name) SELECT u.id,t.company,'Unassigned comfort' FROM unavailable_type u CROSS JOIN test_ids t;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF jsonb_array_length(public.nearby_cars(43.2,25.6,(SELECT vehicle_type FROM test_ids))->'cars')<>1 THEN RAISE EXCEPTION 'FAIL selected operator ignored on map'; END IF;
END $$;
DO $$ DECLARE data jsonb; BEGIN
 SELECT public.booking_availability(company,43.2,25.6) INTO data FROM test_ids;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'categories') c WHERE c->>'id'=(SELECT vehicle_type::text FROM test_ids) AND (c->>'drivers')::int=1) THEN RAISE EXCEPTION 'FAIL ready vehicle missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(data->'categories') c WHERE c->>'id'=(SELECT id::text FROM unavailable_type) AND (c->>'drivers')::int=0 AND NOT (c->>'configured')::boolean) THEN RAISE EXCEPTION 'FAIL unavailable comfort offered'; END IF;
 IF data::text LIKE '%user_id%' OR data::text LIKE '%latitude%' THEN RAISE EXCEPTION 'FAIL driver identity/location exposed'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.ride_quotes(customer_id,company_id,vehicle_type_id,payload)
 SELECT customer,company,u.id,'{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.3,"destination_longitude":25.7,"pickup_address":"Test","destination_address":"Test","distance_km":12,"duration_min":20,"total":15}'::jsonb FROM test_ids CROSS JOIN unavailable_type u;
CREATE TEMP TABLE unavailable_quote AS SELECT id FROM public.ride_quotes WHERE vehicle_type_id=(SELECT id FROM unavailable_type);
GRANT SELECT ON unavailable_quote TO authenticated;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.create_taxi_request((SELECT id FROM unavailable_quote),gen_random_uuid(),''cash'')');
RESET ROLE;
UPDATE public.drivers SET is_online=false WHERE id=(SELECT driver FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ DECLARE data jsonb; BEGIN
 SELECT public.booking_availability(company,43.2,25.6) INTO data FROM test_ids;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(data->'categories') c WHERE (c->>'drivers')::int<>0) THEN RAISE EXCEPTION 'FAIL offline driver offered'; END IF;
 -- An already-created request remains idempotent after its driver is offline.
 IF (SELECT (public.create_taxi_request(quote,gen_random_uuid(),'cash')).id FROM test_ids)<>(SELECT request FROM test_ids) THEN RAISE EXCEPTION 'FAIL existing booking lost'; END IF;
END $$;
RESET ROLE;
UPDATE public.profiles SET company_id=(SELECT company FROM test_ids) WHERE id=(SELECT customer FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.booking_availability((SELECT company FROM test_ids),43.2,25.6)');
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.booking_availability(uuid,double precision,double precision)','EXECUTE') THEN RAISE EXCEPTION 'FAIL anonymous booking availability'; END IF;
END $$;
SELECT 'PASS: exact dispatch category, offline readiness, private aggregate, no-driver creation and idempotence' result;
