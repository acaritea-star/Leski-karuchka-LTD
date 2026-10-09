-- Catalog assertions complement the behavioral ownership/isolation tests.
BEGIN;
DO $$
DECLARE name text; api regprocedure; internal regprocedure;
BEGIN
 FOREACH name IN ARRAY ARRAY['confirm_ride_start(uuid)','ride_observations(uuid,timestamptz,integer)',
  'record_operation_metrics(uuid,jsonb)','operational_health(uuid)'] LOOP
  api:=('public.'||name)::regprocedure;
  internal:=('private.'||name)::regprocedure;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=api) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=internal)
   OR has_function_privilege('anon',api,'EXECUTE') OR has_function_privilege('anon',internal,'EXECUTE')
   OR NOT has_function_privilege('authenticated',api,'EXECUTE') OR NOT has_function_privilege('authenticated',internal,'EXECUTE')
   THEN RAISE EXCEPTION 'FAIL P1 API boundary: %',name; END IF;
 END LOOP;
 api:='public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid)'::regprocedure;
 internal:='private.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid)'::regprocedure;
 IF (SELECT prosecdef FROM pg_proc WHERE oid=api) OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=internal)
  OR has_function_privilege('anon',api,'EXECUTE') OR has_function_privilege('authenticated',api,'EXECUTE')
  OR has_function_privilege('authenticated',internal,'EXECUTE') OR NOT has_function_privilege('service_role',api,'EXECUTE')
  OR NOT has_function_privilege('service_role',internal,'EXECUTE') THEN RAISE EXCEPTION 'FAIL route service boundary'; END IF;
END $$;
SELECT 'PASS: P1 public invoker/private implementation, anonymous denial and service-only route reservation' AS result;
ROLLBACK;
