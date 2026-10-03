SAVEPOINT nearby_suite;
-- Run after core.sql inside the same rollback-only transaction.
RESET ROLE;
UPDATE public.profiles SET company_id=(SELECT company FROM test_ids) WHERE id=(SELECT customer FROM test_ids);
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
UPDATE public.driver_locations SET latitude=43.20004,longitude=25.60004,position_at=clock_timestamp(),updated_at=clock_timestamp(),accuracy=10 WHERE driver_id=(SELECT driver FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE preview jsonb;car jsonb; BEGIN
 preview:=public.nearby_cars(43.2,25.6,(SELECT vehicle_type FROM test_ids));
 IF jsonb_array_length(preview->'cars')<>1 THEN RAISE EXCEPTION 'FAIL nearby valid online car'; END IF;
 car:=preview->'cars'->0;
 IF car ? 'driver_id' OR car ? 'user_id' OR car ? 'phone' OR car ? 'name' THEN RAISE EXCEPTION 'FAIL identity leakage'; END IF;
 IF (car->>'lat')::double precision<>43.2 OR (car->>'lng')::double precision<>25.6 THEN RAISE EXCEPTION 'FAIL approximate preview'; END IF;
 IF length(car->>'token')<>32 THEN RAISE EXCEPTION 'FAIL viewer token'; END IF;
END $$;
SELECT pg_temp.must_fail('SELECT public.nearby_cars(43.2,25.6)');
SELECT pg_temp.must_fail('SELECT public.nearby_cars(48,2)');
SELECT pg_temp.must_fail('SELECT public.nearby_cars(NULL,25.6)');
SELECT pg_temp.must_fail('SELECT public.road_tile_cache(''9999:9999'')');
SELECT pg_temp.must_fail('SELECT * FROM private.road_tiles');
-- Clear only this synthetic user's rate row between independent assertions.
RESET ROLE; DELETE FROM private.nearby_read_limits WHERE user_id=(SELECT customer FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.2,25.6,gen_random_uuid())->'cars')<>0 THEN RAISE EXCEPTION 'FAIL wrong vehicle type'; END IF; END $$;
RESET ROLE; DELETE FROM private.nearby_read_limits WHERE user_id=(SELECT customer FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.22,25.6)->'cars')<>0 THEN RAISE EXCEPTION 'FAIL distant car'; END IF; END $$;
RESET ROLE; DELETE FROM private.nearby_read_limits WHERE user_id=(SELECT customer FROM test_ids);
UPDATE public.drivers SET is_online=false WHERE id=(SELECT driver FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.2,25.6)->'cars')<>0 THEN RAISE EXCEPTION 'FAIL offline car'; END IF; END $$;
RESET ROLE; DELETE FROM private.nearby_read_limits WHERE user_id=(SELECT customer FROM test_ids);
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM test_ids);
DELETE FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at) SELECT driver,company,43.2,25.6,10,clock_timestamp()-interval '46 seconds' FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.2,25.6)->'cars')<>0 THEN RAISE EXCEPTION 'FAIL stale car'; END IF; END $$;
RESET ROLE; DELETE FROM private.nearby_read_limits WHERE user_id=(SELECT customer FROM test_ids);
UPDATE public.driver_locations SET position_at=clock_timestamp(),updated_at=clock_timestamp() WHERE driver_id=(SELECT driver FROM test_ids);
SAVEPOINT busy_preview;
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT request FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.2,25.6)->'cars')<>0 THEN RAISE EXCEPTION 'FAIL busy car'; END IF; END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT busy_preview;
RELEASE SAVEPOINT busy_preview;
SAVEPOINT company_preview;
INSERT INTO public.companies(name,slug) SELECT 'Preview isolation','preview-'||company FROM test_ids;
UPDATE public.profiles SET company_id=(SELECT id FROM public.companies WHERE slug='preview-'||(SELECT company::text FROM test_ids)) WHERE id=(SELECT customer FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF jsonb_array_length(public.nearby_cars(43.2,25.6)->'cars')<>0 THEN RAISE EXCEPTION 'FAIL other company car'; END IF; END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT company_preview;
RELEASE SAVEPOINT company_preview;
UPDATE public.profiles SET is_active=false WHERE id=(SELECT customer FROM test_ids);
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.nearby_cars(43.2,25.6)');
RESET ROLE; UPDATE public.profiles SET is_active=true WHERE id=(SELECT customer FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.nearby_cars(43.2,25.6)');
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','public.nearby_cars(double precision,double precision,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.road_tile_cache(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'FAIL preview/cache ACL'; END IF;
END $$;
-- Simulate service requests: a cold tile is fetched once, concurrent readers
-- receive the lease; saved public geometry then serves from the week-long cache.
DO $$ DECLARE result jsonb; BEGIN
 DELETE FROM private.road_tiles WHERE key IN ('9999:9999','9998:9998');
 DELETE FROM private.road_fetch_budget WHERE day=current_date;
 result:=public.road_tile_cache('9999:9999');
 IF result->>'fetch'<>'true' THEN RAISE EXCEPTION 'FAIL cache lease'; END IF;
 IF public.road_tile_cache('9999:9999')->>'fetch'<>'false' THEN RAISE EXCEPTION 'FAIL concurrent cache lease'; END IF;
 PERFORM public.road_tile_cache('9999:9999','[{"points":[[43,25],[43.001,25]],"oneway":0}]');
 IF public.road_tile_cache('9999:9999')->>'fetch'<>'false' OR jsonb_array_length(public.road_tile_cache('9999:9999')->'roads')<>1 THEN RAISE EXCEPTION 'FAIL cached roads'; END IF;
 UPDATE private.road_fetch_budget SET requests=30 WHERE day=current_date;
 IF public.road_tile_cache('9998:9998')->>'fetch'<>'false' THEN RAISE EXCEPTION 'FAIL daily upstream cap'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN IF public.road_tile_cache('9999:9999')->>'fetch'<>'false' THEN RAISE EXCEPTION 'FAIL service cache access'; END IF; END $$;
RESET ROLE;
SELECT 'PASS: nearby eligibility, distance, type, offline/stale/inactive, rate limit, approximate coordinates, private access, cache lease and daily upstream cap' AS result;

ROLLBACK TO SAVEPOINT nearby_suite;
RELEASE SAVEPOINT nearby_suite;
