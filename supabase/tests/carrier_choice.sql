-- Two distinct carriers, one offer: isolated fixtures, no Google/email/push HTTP.
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

INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT quote,customer,company_a,type_a,jsonb_build_object('pickup_latitude',43.2,'pickup_longitude',25.6,
 'destination_latitude',43.3,'destination_longitude',25.7,'pickup_address','Exact pickup','destination_address','Exact destination',
 'distance_km',8.805,'duration_min',16,'total',12.08,'breakdown',jsonb_build_object('total',12.08,
 'carrier_choice',jsonb_build_object('service_class','standard','company_name','Market A','type_name','Eco','capacity',4))) FROM market_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
SELECT public.create_taxi_request(quote,ride,'cash') IS NOT NULL FROM market_ids;
DO $$ BEGIN
 BEGIN PERFORM private.accept_request((SELECT ride FROM market_ids)); EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL customer accepted a request'; END $$;
RESET ROLE;
DO $$ DECLARE tariffs jsonb; BEGIN
 tariffs:=public.marketplace_quote_types(43.2,25.6);
 IF jsonb_array_length(tariffs)<>2 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tariffs) t WHERE t->>'company_name'='Market A' AND t->>'type_name'='Eco' AND (t->>'capacity')::int=4)
 THEN RAISE EXCEPTION 'FAIL named carrier tariff identity'; END IF;
 IF (SELECT count(*) FROM public.request_push_recipients((SELECT ride FROM market_ids)))<>1
 OR EXISTS(SELECT 1 FROM public.request_push_recipients((SELECT ride FROM market_ids)) WHERE user_id=(SELECT b_user FROM market_ids))
 THEN RAISE EXCEPTION 'FAIL different carrier notified for an exact choice'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',b_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids))
 THEN RAISE EXCEPTION 'FAIL foreign carrier incoming offer'; END IF;
 BEGIN PERFORM public.accept_taxi_request((SELECT ride FROM market_ids)); EXCEPTION WHEN insufficient_privilege THEN RETURN; END;
 RAISE EXCEPTION 'FAIL foreign carrier accepted exact offer'; END $$;
RESET ROLE;
-- Server receipt can be fresh while the underlying measurement is old.
UPDATE public.driver_locations SET position_at=clock_timestamp()-interval '50 seconds' WHERE driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT a_user FROM market_ids));
SELECT set_config('request.jwt.claims',json_build_object('sub',a_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids)) THEN RAISE EXCEPTION 'FAIL stale GPS offer'; END IF;
 BEGIN PERFORM public.accept_taxi_request((SELECT ride FROM market_ids));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'GPS_STALE:%' THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'FAIL no GPS diagnostic'; END $$;
RESET ROLE;
UPDATE public.driver_locations SET position_at=clock_timestamp() WHERE driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT a_user FROM market_ids));
SELECT set_config('request.jwt.claims',json_build_object('sub',a_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
SELECT public.accept_taxi_request(ride) IS NOT NULL FROM market_ids;
DO $$ DECLARE r public.taxi_requests; BEGIN
 SELECT accepted.* INTO r FROM market_ids CROSS JOIN LATERAL public.accept_taxi_request(ride) accepted;
 IF r.company_id<>(SELECT company_a FROM market_ids) OR r.vehicle_type_id<>(SELECT type_a FROM market_ids)
 OR r.estimated_price<>12.08 OR (r.fare_breakdown->>'total')::numeric<>12.08 OR r.status<>'accepted'
 THEN RAISE EXCEPTION 'FAIL exact carrier fare changed during acceptance'; END IF;
END $$;
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT ride FROM market_ids);
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT ride FROM market_ids);
UPDATE public.taxi_requests SET status='completed' WHERE id=(SELECT ride FROM market_ids);
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.trips WHERE request_id=(SELECT ride FROM market_ids) AND total_amount=12.08 AND company_id=(SELECT company_a FROM market_ids))
 OR (SELECT count(*) FROM private.push_outbox WHERE request_id=(SELECT ride FROM market_ids) AND event_type='accepted')<>1
 THEN RAISE EXCEPTION 'FAIL exact-fare accounting or duplicate acceptance'; END IF;
 IF has_function_privilege('anon','private.accept_request(uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL anonymous acceptance helper'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS exact selected carrier, immutable fare through accounting, stale GPS diagnosis, foreign carrier exclusion and replay safety' result;
