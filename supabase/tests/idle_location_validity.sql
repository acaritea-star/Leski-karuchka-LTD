BEGIN;
DO $$ DECLARE t timestamptz:=clock_timestamp(); s double precision; BEGIN
 FOREACH s IN ARRAY ARRAY[NULL::double precision,0,1.49] LOOP
  IF NOT private.location_is_current(t-interval '61 seconds',t-interval '61 seconds',s,t)
   OR NOT private.location_is_current(t-interval '89 seconds',t-interval '89 seconds',s,t)
   OR private.location_is_current(t,t-interval '90 seconds',s,t)
   OR private.location_is_current(t-interval '90 seconds',t,s,t)
  THEN RAISE EXCEPTION 'FAIL idle validity boundary'; END IF;
 END LOOP;
 FOREACH s IN ARRAY ARRAY[1.5,10,'NaN'::double precision,'Infinity'::double precision,-1] LOOP
  IF NOT private.location_is_current(t,t-interval '44 seconds',s,t)
   OR private.location_is_current(t,t-interval '45 seconds',s,t)
  THEN RAISE EXCEPTION 'FAIL moving validity boundary'; END IF;
 END LOOP;
 IF private.location_is_current(t,NULL,0,t) OR private.location_is_current(NULL,t,0,t)
  OR private.location_is_current(t,t+interval '31 seconds',0,t)
  OR private.location_is_current(t+interval '31 seconds',t,0,t)
  OR private.fleet_online(false,true,t,t,t,0)
  OR private.fleet_online(true,false,t,t,t,0)
  OR NOT private.fleet_online(true,true,t-interval '61 seconds',t-interval '61 seconds',t,NULL)
  OR private.fleet_online(true,true,t,t-interval '46 seconds',t,5)
 THEN RAISE EXCEPTION 'FAIL invalid GPS or fleet state'; END IF;
 IF has_function_privilege('anon','private.location_is_current(timestamptz,timestamptz,double precision,timestamptz)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL anonymous helper privilege'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS bounded idle/moving GPS validity and timestamp integrity' result;
