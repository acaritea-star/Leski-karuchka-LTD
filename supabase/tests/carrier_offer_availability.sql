-- Per-carrier availability and same-firm fan-out. Rollback-only local fixtures.
BEGIN;
CREATE TEMP TABLE market_ids AS SELECT gen_random_uuid() customer,gen_random_uuid() a_user,gen_random_uuid() b_user,
 gen_random_uuid() far_user,gen_random_uuid() company_a,gen_random_uuid() company_b,gen_random_uuid() company_far,
 gen_random_uuid() type_a,gen_random_uuid() type_b,gen_random_uuid() type_far,gen_random_uuid() quote,gen_random_uuid() ride;
GRANT SELECT ON market_ids TO authenticated;
INSERT INTO public.companies(id,name,slug,dispatch_radius_km)
 SELECT company_a,'Market A','ma-'||company_a,5 FROM market_ids UNION ALL
 SELECT company_b,'Market B','mb-'||company_b,9 FROM market_ids UNION ALL
 SELECT company_far,'Far market','mf-'||company_far,5 FROM market_ids;
INSERT INTO auth.users(id,email)
 SELECT customer,customer||'@example.invalid' FROM market_ids UNION ALL
 SELECT a_user,a_user||'@example.invalid' FROM market_ids UNION ALL
 SELECT b_user,b_user||'@example.invalid' FROM market_ids UNION ALL
 SELECT far_user,far_user||'@example.invalid' FROM market_ids;
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company_a FROM market_ids) WHERE id=(SELECT a_user FROM market_ids);
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company_b FROM market_ids) WHERE id=(SELECT b_user FROM market_ids);
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company_far FROM market_ids) WHERE id=(SELECT far_user FROM market_ids);
INSERT INTO public.vehicle_types(id,company_id,name,service_class)
 SELECT type_a,company_a,'Eco','standard' FROM market_ids UNION ALL
 SELECT type_b,company_b,'Market Standard','standard' FROM market_ids UNION ALL
 SELECT type_far,company_far,'Far standard','standard' FROM market_ids;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT a_user,company_a,type_a,'Fixture','A','MA-'||left(a_user::text,8) FROM market_ids UNION ALL
 SELECT b_user,company_b,type_b,'Fixture','B','MB-'||left(b_user::text,8) FROM market_ids UNION ALL
 SELECT far_user,company_far,type_far,'Fixture','Far','MF-'||left(far_user::text,8) FROM market_ids;
UPDATE public.drivers SET vehicle_id=user_id,is_verified=true,document_verification_required=false
 WHERE user_id IN (SELECT a_user FROM market_ids UNION ALL SELECT b_user FROM market_ids UNION ALL SELECT far_user FROM market_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT d.id,d.company_id,CASE WHEN d.user_id=i.far_user THEN 42.6977 ELSE 43.2 END,
 CASE WHEN d.user_id=i.far_user THEN 23.3219 ELSE 25.6 END,10,clock_timestamp()
 FROM public.drivers d CROSS JOIN market_ids i WHERE d.user_id IN (i.a_user,i.b_user,i.far_user);
UPDATE public.drivers SET is_online=true WHERE user_id IN (SELECT a_user FROM market_ids UNION ALL SELECT b_user FROM market_ids UNION ALL SELECT far_user FROM market_ids);

CREATE TEMP TABLE extra_drivers AS
 SELECT kind, gen_random_uuid() user_id FROM unnest(ARRAY['ready','offline','stale','busy','wrong_type','unverified','inactive_vehicle','inactive_profile']) kind;
CREATE TEMP TABLE extra_ids AS SELECT gen_random_uuid() type_other, gen_random_uuid() busy_customer;
GRANT SELECT ON extra_drivers, extra_ids TO authenticated;
INSERT INTO auth.users(id,email) SELECT user_id,user_id||'@example.invalid' FROM extra_drivers
 UNION ALL SELECT busy_customer,busy_customer||'@example.invalid' FROM extra_ids;
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company_a FROM market_ids)
 WHERE id IN (SELECT user_id FROM extra_drivers);
INSERT INTO public.vehicle_types(id,company_id,name,service_class)
 SELECT type_other,company_a,'Comfort','comfort' FROM extra_ids CROSS JOIN market_ids;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT e.user_id,i.company_a,CASE WHEN e.kind='wrong_type' THEN x.type_other ELSE i.type_a END,
 'Fixture',e.kind,'EX-'||left(e.user_id::text,8) FROM extra_drivers e CROSS JOIN market_ids i CROSS JOIN extra_ids x;
UPDATE public.drivers SET vehicle_id=user_id,is_verified=true,document_verification_required=false
 WHERE user_id IN (SELECT user_id FROM extra_drivers);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT d.id,d.company_id,43.2,25.6,10,clock_timestamp() FROM public.drivers d JOIN extra_drivers e ON e.user_id=d.user_id;
UPDATE public.drivers SET is_online=true WHERE user_id IN (SELECT user_id FROM extra_drivers WHERE kind<>'offline');
-- A delayed moving measurement is writable (<60s) but no longer dispatchable
-- (>=45s). Insert it afresh because out-of-order updates are correctly ignored.
DELETE FROM public.driver_locations
 WHERE driver_id IN (SELECT d.id FROM public.drivers d JOIN extra_drivers e ON e.user_id=d.user_id WHERE e.kind='stale');
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,speed,position_at)
 SELECT d.id,d.company_id,43.2,25.6,10,5,clock_timestamp()-interval '50 seconds'
 FROM public.drivers d JOIN extra_drivers e ON e.user_id=d.user_id WHERE e.kind='stale';
UPDATE public.drivers SET is_verified=false WHERE user_id=(SELECT user_id FROM extra_drivers WHERE kind='unverified');
UPDATE public.vehicles SET is_active=false WHERE id=(SELECT user_id FROM extra_drivers WHERE kind='inactive_vehicle');
UPDATE public.profiles SET is_active=false WHERE id=(SELECT user_id FROM extra_drivers WHERE kind='inactive_profile');
INSERT INTO public.taxi_requests(company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,fare_breakdown)
 SELECT i.company_a,x.busy_customer,d.id,i.type_a,43.2,25.6,43.3,25.7,'accepted',5,'{"total":5}'::jsonb
 FROM market_ids i CROSS JOIN extra_ids x JOIN public.drivers d ON d.user_id=(SELECT user_id FROM extra_drivers WHERE kind='busy');

SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.marketplace_availability(43.2,25.6);
 IF jsonb_array_length(result->'carriers')<>3
 OR NOT (result->'carriers' @> (SELECT jsonb_build_array(jsonb_build_object('company_id',company_a,'vehicle_type_id',type_a,'service_class','standard')) FROM market_ids))
 OR NOT (result->'categories' @> '[{"id":"standard","drivers":3,"configured":true},{"id":"comfort","drivers":1,"configured":true},{"id":"van","drivers":0,"configured":false}]'::jsonb)
 THEN RAISE EXCEPTION 'FAIL unique carrier/type availability or legacy category counts: %',result; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'carriers') c
   WHERE c-ARRAY['company_id','vehicle_type_id','service_class']<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'FAIL carrier availability exposes driver details'; END IF;
END $$;
RESET ROLE;
-- Losing all standard cars at A must not be masked by B or by A's Comfort car.
UPDATE public.drivers SET is_online=false WHERE user_id=(SELECT a_user FROM market_ids)
 OR user_id=(SELECT user_id FROM extra_drivers WHERE kind='ready');
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.marketplace_availability(43.2,25.6);
 IF result->'carriers' @> (SELECT jsonb_build_array(jsonb_build_object('company_id',company_a,'vehicle_type_id',type_a)) FROM market_ids)
 OR NOT (result->'carriers' @> (SELECT jsonb_build_array(jsonb_build_object('company_id',company_b,'vehicle_type_id',type_b)) FROM market_ids))
 OR NOT (result->'categories' @> '[{"id":"standard","drivers":1}]'::jsonb)
 THEN RAISE EXCEPTION 'FAIL foreign carrier keeps selected carrier available'; END IF;
END $$;
RESET ROLE;
UPDATE public.drivers SET is_online=true WHERE user_id=(SELECT a_user FROM market_ids)
 OR user_id=(SELECT user_id FROM extra_drivers WHERE kind='ready');

INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company_a,type_a,jsonb_build_object('pickup_latitude',43.2,'pickup_longitude',25.6,
 'destination_latitude',43.3,'destination_longitude',25.7,'pickup_address','Exact pickup','destination_address','Exact destination',
 'distance_km',8.805,'duration_min',16,'total',12.08,'breakdown',jsonb_build_object('total',12.08,
 'carrier_choice',jsonb_build_object('service_class','standard','company_name','Market A','type_name','Eco','capacity',4))) FROM market_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,ride,'cash') IS NOT NULL FROM market_ids;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.request_push_recipients((SELECT ride FROM market_ids)))<>2
 OR EXISTS(SELECT 1 FROM public.request_push_recipients((SELECT ride FROM market_ids))
   WHERE user_id NOT IN (SELECT a_user FROM market_ids UNION ALL SELECT user_id FROM extra_drivers WHERE kind='ready'))
 THEN RAISE EXCEPTION 'FAIL exact offer must reach both and only eligible drivers of chosen firm'; END IF;
END $$;
-- Both eligible drivers see the pending offer in their panel.
SELECT set_config('request.jwt.claims',json_build_object('sub',user_id,'role','authenticated')::text,true) FROM extra_drivers WHERE kind='ready';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids))
 THEN RAISE EXCEPTION 'FAIL second eligible driver did not receive the offer'; END IF;
 -- A driver cannot call the customer-only fleet availability endpoint.
 BEGIN PERFORM public.marketplace_availability(43.2,25.6);
 EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL driver read customer availability';
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',a_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids))
 THEN RAISE EXCEPTION 'FAIL first eligible driver did not receive the offer'; END IF;
END $$;
SELECT public.accept_taxi_request(ride) IS NOT NULL FROM market_ids;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',user_id,'role','authenticated')::text,true) FROM extra_drivers WHERE kind='ready';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids))
 THEN RAISE EXCEPTION 'FAIL claimed offer remains visible to another driver'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.request_push_recipients((SELECT ride FROM market_ids)))
 THEN RAISE EXCEPTION 'FAIL accepted offer still broadcasts'; END IF;
 IF has_function_privilege('anon','private.marketplace_availability(double precision,double precision)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL anonymous availability access'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS per-carrier availability, two-driver fan-out, eligibility filters, claim removal and privacy' result;
