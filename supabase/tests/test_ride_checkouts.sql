-- Explicitly simulated, rollback-only. No external calls and no real postings.
BEGIN;
UPDATE private.app_security SET staff_mfa_enforced=false;
CREATE FUNCTION pg_temp.test_ride_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $t$
DECLARE root uuid:=gen_random_uuid();city uuid:=gen_random_uuid();duid uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();admin_id uuid:=gen_random_uuid();did uuid;vt uuid:=gen_random_uuid();ride uuid:=gen_random_uuid();ride2 uuid:=gen_random_uuid();o jsonb;report jsonb;before_ride jsonb;before_order jsonb;aid text:='acct_1USiOkPYGWX41ye8';
BEGIN
 INSERT INTO public.companies(id,name,slug)VALUES(root,'Test root','test-root-'||root);
 INSERT INTO public.companies(id,name,slug,parent_company_id,service_city,service_latitude,service_longitude,service_radius_km)VALUES(city,'Test branch','test-city-'||city,root,'Synthetic',43.2,25.6,5);
 INSERT INTO private.ride_stripe_merchants(account_id,root_company_id,enabled,livemode)VALUES(aid,root,true,false);
 INSERT INTO auth.users(id,email)SELECT u,'test-ride-'||u||'@example.invalid' FROM unnest(ARRAY[duid,customer,outsider,admin_id])t(u);
 UPDATE public.profiles SET role='DRIVER',company_id=city WHERE id=duid;SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=city WHERE id=admin_id;
 INSERT INTO public.vehicle_types(id,company_id,name)VALUES(vt,city,'Synthetic');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF (public.ride_payment_state(ride)->>'eligible')::boolean THEN RAISE EXCEPTION 'FAIL non-test customer can test';END IF;
 PERFORM pg_temp.test_ride_denied(format('UPDATE public.taxi_requests SET payment_environment=''test'' WHERE id=%L',ride));
 EXECUTE 'RESET ROLE';
 INSERT INTO private.ride_stripe_test_customers VALUES(customer,root,true);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride);
 IF public.ride_payment_state(ride)->>'environment'<>'test' OR NOT(public.ride_payment_state(ride)->>'eligible')::boolean THEN RAISE EXCEPTION 'FAIL test eligibility';END IF;
 PERFORM pg_temp.test_ride_denied('SELECT * FROM private.ride_stripe_test_customers');EXECUTE 'RESET ROLE';
 PERFORM pg_temp.test_ride_denied(format('SELECT private.begin_ride_checkout(%L,%L,%L)',ride,outsider,aid));
 o:=private.begin_ride_checkout(ride,customer,aid);
 IF (o->>'livemode')::boolean OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND payment_environment='test') THEN RAISE EXCEPTION 'FAIL test reservation';END IF;
 PERFORM pg_temp.test_ride_denied(format('SELECT private.attach_ride_checkout(%L,''cs_live_wrong'',''https://checkout.stripe.com/c/pay/cs_live_wrong'')',o->>'id'));
 PERFORM private.attach_ride_checkout((o->>'id')::uuid,'cs_test_ride','https://checkout.stripe.com/c/pay/cs_test_ride');
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_ride','pi_testRide','evt_test_paid','paid',1234,1234,0);
 SELECT to_jsonb(r) INTO before_ride FROM public.taxi_requests r WHERE id=ride;
 SELECT to_jsonb(r) INTO before_order FROM private.ride_stripe_orders r WHERE id=(o->>'id')::uuid;
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_ride','pi_testRide','evt_test_paid','paid',1234,1234,0);
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_ride','pi_testRide','evt_test_second_paid','paid',1234,1234,0);
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_ride','pi_testRide','evt_test_old_open','open',1234,0,0);
 IF before_ride IS DISTINCT FROM (SELECT to_jsonb(r) FROM public.taxi_requests r WHERE id=ride) OR before_order IS DISTINCT FROM (SELECT to_jsonb(r) FROM private.ride_stripe_orders r WHERE id=(o->>'id')::uuid) THEN RAISE EXCEPTION 'FAIL repeated settlement changed rows or timestamps';END IF;
 IF (SELECT count(*) FROM private.ride_stripe_events WHERE order_id=(o->>'id')::uuid)<>3 THEN RAISE EXCEPTION 'FAIL event audit was lost';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND status='completed' AND payment_environment='test' AND payment_status='paid') THEN RAISE EXCEPTION 'FAIL test lifecycle completion';END IF;
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE request_id=ride) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=ride) OR EXISTS(SELECT 1 FROM public.request_outcomes WHERE request_id=ride) OR EXISTS(SELECT 1 FROM public.trips WHERE request_id=ride) THEN RAISE EXCEPTION 'FAIL simulated money entered real accounting';END IF;
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_ride','pi_testRide','evt_test_refund','paid',1234,1234,100);
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE request_id=ride) THEN RAISE EXCEPTION 'FAIL test refund posted';END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 report:=public.accounting_report(current_date,current_date+1,city,did,0);
 IF (report#>>'{online_funds,net}')::numeric<>0 OR (report#>>'{totals,completed}')::bigint<>0 OR (report#>>'{totals,unreported_completed}')::bigint<>0 OR (public.driver_day_summary(did,current_date)->>'earnings')::numeric<>0 THEN RAISE EXCEPTION 'FAIL test contaminated reports';END IF;
 EXECUTE 'RESET ROLE';PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF (public.company_dashboard(city,current_date)#>>'{stats,totalRevenue}')::numeric<>0 THEN RAISE EXCEPTION 'FAIL test counted as revenue';END IF;EXECUTE 'RESET ROLE';
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride2,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride2);EXECUTE 'RESET ROLE';
 o:=private.begin_ride_checkout(ride2,customer,aid);PERFORM private.attach_ride_checkout((o->>'id')::uuid,'cs_test_cancel','https://checkout.stripe.com/c/pay/cs_test_cancel');
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_cancel',NULL,'evt_test_expired','canceled',1234,0,0);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.test_ride_denied(format('SELECT public.complete_ride_payment(%L,%L,%L,''cash'')',gen_random_uuid(),ride2,duid));
 PERFORM pg_temp.test_ride_denied(format('SELECT public.record_driver_money_method(%L,''income'',12.34,''Fake test cash'',%L,''cash'',%L)',gen_random_uuid(),duid,ride2));
 EXECUTE 'RESET ROLE';
END $t$;
ROLLBACK;
