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
 SELECT quote,customer,company_b,type_b,jsonb_build_object('pickup_latitude',43.2,'pickup_longitude',25.6,
 'destination_latitude',43.3,'destination_longitude',25.7,'pickup_address','Market pickup','destination_address','Market destination',
 'distance_km',12,'duration_min',20,'total',12,'breakdown',jsonb_build_object('total',12,'marketplace',jsonb_build_object('service_class','standard',
 'min',10,'max',12,'offers',jsonb_build_array(
 jsonb_build_object('company_id',company_a,'vehicle_type_id',type_a,'total',10,'breakdown',jsonb_build_object('total',10)),
 jsonb_build_object('company_id',company_b,'vehicle_type_id',type_b,'total',12,'breakdown',jsonb_build_object('total',12)))))) FROM market_ids;
CREATE FUNCTION pg_temp.market_denied(q text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN BEGIN EXECUTE q; EXCEPTION WHEN OTHERS THEN IF SQLSTATE IN ('42501','P0001') THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'FAIL unexpected access: %',q; END $$;
CREATE TEMP TABLE incomplete_market_quote AS SELECT gen_random_uuid() id;
GRANT SELECT ON incomplete_market_quote TO authenticated;
INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 SELECT bad.id,q.customer_id,q.company_id,q.vehicle_type_id,
 jsonb_set(q.payload,'{breakdown,marketplace,offers}',jsonb_build_array(q.payload->'breakdown'->'marketplace'->'offers'->0))
 FROM public.ride_quotes q CROSS JOIN incomplete_market_quote bad WHERE q.id=(SELECT quote FROM market_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE ready jsonb; BEGIN
 ready:=public.marketplace_availability(43.2,25.6);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ready->'categories') c WHERE c->>'id'='standard' AND (c->>'drivers')::int=2) THEN RAISE EXCEPTION 'FAIL combined carriers'; END IF;
 IF ready::text LIKE '%user_id%' OR ready::text LIKE '%latitude%' THEN RAISE EXCEPTION 'FAIL location/identity exposed'; END IF;
END $$;
DO $$ BEGIN
 BEGIN PERFORM public.create_taxi_request((SELECT id FROM incomplete_market_quote),gen_random_uuid(),'cash');
 EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'QUOTE_FLEET_CHANGED:%' THEN RETURN; END IF; RAISE; END;
 RAISE EXCEPTION 'FAIL incomplete carrier quote accepted';
END $$;
SELECT public.create_taxi_request(quote,ride,'cash') IS NOT NULL FROM market_ids;
SELECT pg_temp.market_denied('SELECT private.accept_marketplace_request(ride) FROM market_ids');
SELECT pg_temp.market_denied('SELECT public.marketplace_quote_types(43.2,25.6)');
RESET ROLE;
DO $$ BEGIN IF (SELECT count(*) FROM public.request_push_recipients((SELECT ride FROM market_ids)))<>2 THEN RAISE EXCEPTION 'FAIL both carriers must receive offer'; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=(SELECT a_user FROM market_ids) AND company_id=(SELECT company_a FROM market_ids) AND type='new_request')
 THEN RAISE EXCEPTION 'FAIL notification carrier ownership'; END IF; END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',b_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids) AND estimated_price=12) THEN RAISE EXCEPTION 'FAIL B own tariff'; END IF; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',a_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids) AND estimated_price=10) THEN RAISE EXCEPTION 'FAIL A own tariff'; END IF; END $$;
SELECT pg_temp.market_denied('UPDATE public.taxi_requests SET company_id=(SELECT company_a FROM market_ids),estimated_price=0 WHERE id=(SELECT ride FROM market_ids)');
SELECT pg_temp.market_denied('UPDATE public.taxi_requests SET status=''accepted'',driver_id=(SELECT id FROM public.drivers WHERE user_id=(SELECT a_user FROM market_ids)) WHERE id=(SELECT ride FROM market_ids)');
RESET ROLE;
-- Later tariff editing cannot silently change a saved offer.
UPDATE public.companies SET base_fare=99 WHERE id=(SELECT company_a FROM market_ids);
SET LOCAL ROLE authenticated;
SELECT public.accept_taxi_request(ride) FROM market_ids;
DO $$ DECLARE r public.taxi_requests; BEGIN
 SELECT accepted.* INTO r FROM market_ids CROSS JOIN LATERAL public.accept_taxi_request(ride) accepted;
 IF r.company_id<>(SELECT company_a FROM market_ids) OR r.vehicle_type_id<>(SELECT type_a FROM market_ids) OR r.estimated_price<>10
 OR r.accepted_at IS NULL OR (r.fare_breakdown->>'total')::numeric<>10 THEN RAISE EXCEPTION 'FAIL carrier/tariff assignment'; END IF;
END $$;
UPDATE public.taxi_requests SET status='arrived' WHERE id=(SELECT ride FROM market_ids);
UPDATE public.taxi_requests SET status='in_progress' WHERE id=(SELECT ride FROM market_ids);
UPDATE public.taxi_requests SET status='completed',final_price=99 WHERE id=(SELECT ride FROM market_ids);
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.trips WHERE request_id=(SELECT ride FROM market_ids) AND company_id=(SELECT company_a FROM market_ids) AND total_amount=10)
 THEN RAISE EXCEPTION 'FAIL financial carrier/price'; END IF;
 IF (SELECT count(*) FROM private.push_outbox WHERE request_id=(SELECT ride FROM market_ids) AND event_type='accepted')<>1 THEN RAISE EXCEPTION 'FAIL repeated acceptance event'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',b_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT ride FROM market_ids)) THEN RAISE EXCEPTION 'FAIL losing carrier sees completed foreign ride'; END IF; END $$;
SELECT pg_temp.market_denied('SELECT public.accept_taxi_request(ride) FROM market_ids');
SELECT pg_temp.market_denied('SELECT public.save_vehicle_category(gen_random_uuid(),company_a,NULL,''{"name":"Foreign","service_class":"standard","capacity":4,"multiplier":1}'') FROM market_ids');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',far_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=(SELECT ride FROM market_ids)) THEN RAISE EXCEPTION 'FAIL far driver receives offer'; END IF; END $$;
RESET ROLE;
UPDATE public.profiles SET role='COMPANY_ADMIN' WHERE id=(SELECT b_user FROM market_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',b_user,'role','authenticated')::text,true) FROM market_ids;
SET LOCAL ROLE authenticated;
DO $$ DECLARE category public.vehicle_types; cid uuid:=gen_random_uuid(); BEGIN
 category:=public.save_vehicle_category(cid,(SELECT company_b FROM market_ids),NULL,'{"name":"Comfort fixture","service_class":"comfort","capacity":4,"multiplier":1.30}');
 IF category.company_id<>(SELECT company_b FROM market_ids) OR category.service_class<>'comfort' OR category.multiplier<>1.30 THEN RAISE EXCEPTION 'FAIL category creation'; END IF;
 IF (public.save_vehicle_category(cid,(SELECT company_b FROM market_ids),NULL,'{"name":"Comfort fixture","service_class":"comfort","capacity":4,"multiplier":1.30}')).id<>cid THEN RAISE EXCEPTION 'FAIL category retry'; END IF;
 PERFORM pg_temp.market_denied(format('SELECT public.save_vehicle_category(%L,%L,%L,''{"name":"Stale fixture","service_class":"comfort","capacity":4,"multiplier":1}'')',cid,(SELECT company_b FROM market_ids),clock_timestamp()-interval '1 day'));
END $$;
SELECT pg_temp.market_denied('SELECT public.save_vehicle_category(gen_random_uuid(),company_a,NULL,''{"name":"Foreign","service_class":"standard","capacity":4,"multiplier":1}'') FROM market_ids');
RESET ROLE;
DO $$ BEGIN IF has_function_privilege('anon','public.marketplace_availability(double precision,double precision)','EXECUTE')
 OR has_function_privilege('authenticated','public.marketplace_quote_types(double precision,double precision)','EXECUTE')
 THEN RAISE EXCEPTION 'FAIL marketplace ACL'; END IF; END $$;
SELECT 'PASS: cross-carrier offers, own prices, winning carrier reports, idempotent acceptance, privacy and distance' result;
ROLLBACK;
