-- Synthetic fixtures, no Stripe calls. All changes roll back.
BEGIN;
UPDATE private.app_security SET staff_mfa_enforced=false;
CREATE FUNCTION pg_temp.inline_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $t$
DECLARE root uuid:=gen_random_uuid();city uuid:=gen_random_uuid();duid uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();did uuid;vt uuid:=gen_random_uuid();ride uuid:=gen_random_uuid();ride2 uuid:=gen_random_uuid();o jsonb;next_order jsonb;aid text:='acct_1USiOkPYGWX41ye8';
BEGIN
 INSERT INTO public.companies(id,name,slug)VALUES(root,'Synthetic root','inline-root-'||root);
 INSERT INTO public.companies(id,name,slug,parent_company_id,service_city,service_latitude,service_longitude,service_radius_km)VALUES(city,'Synthetic branch','inline-city-'||city,root,'Synthetic',43.2,25.6,5);
 INSERT INTO private.ride_stripe_merchants(account_id,root_company_id,enabled,livemode)VALUES(aid,root,true,false);
 INSERT INTO auth.users(id,email)SELECT u,'inline-'||u||'@example.invalid' FROM unnest(ARRAY[duid,customer,outsider])t(u);
 UPDATE public.profiles SET role='DRIVER',company_id=city WHERE id=duid;SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 INSERT INTO public.vehicle_types(id,company_id,name)VALUES(vt,city,'Synthetic');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');

 -- Warmup exposes public configuration solely to this ride's eligible customer.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.ride_payment_state(ride)->'preparation'<>'null'::jsonb THEN RAISE EXCEPTION 'FAIL non-pilot prewarm';END IF;EXECUTE 'RESET ROLE';
 INSERT INTO private.ride_stripe_test_customers VALUES(customer,root,true);
 UPDATE private.ride_stripe_merchants SET publishable_key='pk_test_synthetic' WHERE account_id=aid;
 EXECUTE 'SET LOCAL ROLE authenticated';o:=public.ride_payment_state(ride);EXECUTE 'RESET ROLE';
 IF o->'preparation'<>jsonb_build_object('account_id',aid,'publishable_key','pk_test_synthetic','environment','test') OR o->>'ended_at' IS NOT NULL THEN RAISE EXCEPTION 'FAIL own public preparation';END IF;
 IF EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=ride) THEN RAISE EXCEPTION 'FAIL read created payment';END IF;
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.inline_denied(format('SELECT public.ride_payment_state(%L)',ride));EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF public.ride_payment_state(ride)->'preparation'<>'null'::jsonb THEN RAISE EXCEPTION 'FAIL driver received customer preparation';END IF;EXECUTE 'RESET ROLE';
 DELETE FROM private.ride_stripe_test_customers WHERE customer_id=customer AND root_company_id=root;
 UPDATE private.ride_stripe_merchants SET publishable_key=NULL WHERE account_id=aid;
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.end_ride_trip(ride);EXECUTE 'RESET ROLE';
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 INSERT INTO private.ride_stripe_test_customers VALUES(customer,root,true);
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 UPDATE private.ride_stripe_merchants SET publishable_key='pk_test_synthetic' WHERE account_id=aid;
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,outsider,aid));
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.inline_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 PERFORM pg_temp.inline_denied('SELECT * FROM private.ride_stripe_customers');EXECUTE 'RESET ROLE';
 o:=public.begin_ride_elements_checkout(ride,customer,aid);
 IF o->>'ui_mode'<>'elements' OR (o->>'livemode')::boolean OR (o->>'amount_minor')::integer<>1234 THEN RAISE EXCEPTION 'FAIL inline fare/environment';END IF;
 IF public.begin_ride_elements_checkout(ride,customer,aid)->>'id'<>o->>'id' THEN RAISE EXCEPTION 'FAIL duplicate order';END IF;
 IF public.ride_stripe_customer_context((o->>'id')::uuid,customer)->>'email'<>'stripe-test@example.invalid' THEN RAISE EXCEPTION 'FAIL test PII';END IF;
 PERFORM pg_temp.inline_denied(format('SELECT public.ride_stripe_customer_context(%L,%L)',o->>'id',outsider));
 PERFORM pg_temp.inline_denied(format('SELECT public.bind_ride_stripe_customer(%L,%L,''cus_wrong'')',o->>'id',duid));
 PERFORM pg_temp.inline_denied(format('SELECT public.attach_ride_checkout(%L,''cs_test_inline'',NULL)',o->>'id'));
 o:=public.bind_ride_stripe_customer((o->>'id')::uuid,customer,'cus_inline');
 PERFORM public.bind_ride_stripe_customer((o->>'id')::uuid,customer,'cus_inline');
 PERFORM pg_temp.inline_denied(format('SELECT public.bind_ride_stripe_customer(%L,%L,''cus_another'')',o->>'id',customer));
 PERFORM pg_temp.inline_denied(format('SELECT public.attach_ride_checkout(%L,''cs_live_wrong'',NULL)',o->>'id'));
 PERFORM pg_temp.inline_denied(format('SELECT public.attach_ride_checkout(%L,''cs_test_inline'',''https://checkout.stripe.com/c/pay/cs_test_inline'')',o->>'id'));
 PERFORM public.attach_ride_checkout((o->>'id')::uuid,'cs_test_inline',NULL);
 PERFORM pg_temp.inline_denied(format('SELECT public.attach_ride_checkout(%L,''cs_test_other'',NULL)',o->>'id'));
 PERFORM public.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_inline','pi_inline','evt_inline_paid','paid',1234,1234,0);
 IF EXISTS(SELECT 1 FROM public.payment_transactions WHERE request_id=ride) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=ride) OR EXISTS(SELECT 1 FROM public.trips WHERE request_id=ride) THEN RAISE EXCEPTION 'FAIL test leaked into real finance';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND payment_status='paid' AND status='completed' AND payment_environment='test') THEN RAISE EXCEPTION 'FAIL inline settlement';END IF;
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride2,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride2);EXECUTE 'RESET ROLE';
 next_order:=public.begin_ride_elements_checkout(ride2,customer,aid);
 IF next_order->>'stripe_customer_id'<>'cus_inline' OR next_order->>'id'=o->>'id' THEN RAISE EXCEPTION 'FAIL own customer reuse';END IF;
 PERFORM public.attach_ride_checkout((next_order->>'id')::uuid,'cs_test_second',NULL);
 PERFORM public.record_ride_stripe_snapshot((next_order->>'id')::uuid,aid,'cs_test_second',NULL,'evt_expire','canceled',1234,0,0);
 next_order:=public.begin_ride_checkout(ride2,customer,aid);
 IF next_order->>'ui_mode'<>'hosted' OR public.begin_ride_elements_checkout(ride2,customer,aid)->>'id'<>next_order->>'id' THEN RAISE EXCEPTION 'FAIL existing hosted order replaced';END IF;
 SELECT to_jsonb(s) INTO o FROM private.ride_stripe_orders s WHERE checkout_session_id='cs_test_second';
 PERFORM public.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_second',NULL,'evt_late_old_expiry','canceled',1234,0,0);
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride2 AND online_payment_state='creating') THEN RAISE EXCEPTION 'FAIL expired old session hid the current payment';END IF;
 PERFORM public.attach_ride_checkout((next_order->>'id')::uuid,'cs_test_hostedLast','https://checkout.stripe.com/c/pay/cs_test_hostedLast');
 PERFORM public.record_ride_stripe_snapshot((next_order->>'id')::uuid,aid,'cs_test_hostedLast',NULL,'evt_expired_before_live','canceled',1234,0,0);
 UPDATE private.ride_stripe_merchants SET livemode=true,publishable_key='pk_live_synthetic' WHERE account_id=aid;
 next_order:=public.begin_ride_elements_checkout(ride2,customer,aid);
 PERFORM public.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_second',NULL,'evt_old_test_after_live','canceled',1234,0,0);
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride2 AND online_payment_state='creating' AND payment_environment='live') THEN RAISE EXCEPTION 'FAIL canceled test corrupted live attempt';END IF;

END $t$;
ROLLBACK;
