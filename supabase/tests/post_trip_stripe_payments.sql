-- Entirely synthetic and rollback-only. No Stripe API calls or real charges.
BEGIN;
UPDATE private.app_security SET staff_mfa_enforced=false;
CREATE FUNCTION pg_temp.stripe_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $t$
DECLARE root uuid:=gen_random_uuid();city uuid:=gen_random_uuid();foreign_city uuid:=gen_random_uuid();duid uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();did uuid;vt uuid:=gen_random_uuid();ride uuid:=gen_random_uuid();ride2 uuid:=gen_random_uuid();op uuid:=gen_random_uuid();o jsonb;r jsonb;report jsonb;aid text:='acct_1USiOkPYGWX41ye8';
BEGIN
 INSERT INTO public.companies(id,name,slug)VALUES(root,'Synthetic root','stripe-root-'||root),(foreign_city,'Foreign','stripe-foreign-'||foreign_city);
 INSERT INTO public.companies(id,name,slug,parent_company_id)VALUES(city,'Synthetic branch','stripe-city-'||city,root);
 INSERT INTO private.ride_stripe_merchants(account_id,root_company_id,enabled)VALUES(aid,root,true);
 INSERT INTO auth.users(id,email)SELECT u,'stripe-'||u||'@example.invalid' FROM unnest(ARRAY[duid,customer,outsider])t(u);
 UPDATE public.profiles SET role='DRIVER',company_id=city WHERE id=duid;SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 INSERT INTO public.vehicle_types(id,company_id,name)VALUES(vt,city,'Synthetic');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF NOT (public.ride_payment_state(ride)->>'eligible')::boolean THEN RAISE EXCEPTION 'FAIL branch eligibility';END IF;
 PERFORM pg_temp.stripe_denied(format('SELECT public.end_ride_trip(%L)',ride));
 PERFORM pg_temp.stripe_denied(format('SELECT public.begin_ride_checkout(%L,%L,%L)',ride,customer,aid));
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.stripe_denied(format('SELECT private.begin_ride_checkout(%L,%L,%L)',ride,customer,aid));
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.end_ride_trip(ride);PERFORM public.end_ride_trip(ride);EXECUTE 'RESET ROLE';
 PERFORM pg_temp.stripe_denied(format('SELECT private.begin_ride_checkout(%L,%L,%L)',ride,outsider,aid));
 o:=private.begin_ride_checkout(ride,customer,aid);
 IF private.begin_ride_checkout(ride,customer,aid)->>'id'<>o->>'id' OR (o->>'amount_minor')::bigint<>1234 THEN RAISE EXCEPTION 'FAIL deterministic server fare';END IF;
 PERFORM private.attach_ride_checkout((o->>'id')::uuid,'cs_live_synthetic','https://checkout.stripe.com/c/pay/cs_live_synthetic');
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.stripe_denied(format('SELECT public.complete_ride_payment(%L,%L,%L,''cash'')',op,ride,duid));EXECUTE 'RESET ROLE';
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_synthetic','pi_synthetic','evt_paid','paid',1234,1234,0);
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_synthetic','pi_synthetic','evt_paid','paid',1234,1234,0);
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_synthetic','pi_synthetic','evt_old','open',1234,0,0);
 IF (SELECT count(*) FROM public.payment_transactions WHERE request_id=ride)<>1 OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=ride)
  OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND status='completed' AND payment_status='paid' AND payment_method='online' AND trip_ended_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL atomic settlement or duplicate cash';END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_driver_money_method(%L,''income'',12.34,''Fake cash'',%L,''cash'',%L)',gen_random_uuid(),duid,ride));
 report:=public.accounting_report(current_date,current_date+1,city,did,0);
 IF (report#>>'{online_funds,net}')::numeric<>12.34 OR (report#>>'{payment_breakdown,cash_closing}')::numeric<>0 OR (report#>>'{totals,unreported_completed}')::bigint<>0 THEN RAISE EXCEPTION 'FAIL online reconciliation: %',report;END IF;
 EXECUTE 'RESET ROLE';
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_synthetic','pi_synthetic','evt_refund','paid',1234,1234,300);
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_synthetic','pi_synthetic','evt_old_refund','paid',1234,1234,100);
 IF (SELECT sum(CASE WHEN provider='stripe_refund' THEN -amount ELSE amount END) FROM public.payment_transactions WHERE request_id=ride)<>9.34 THEN RAISE EXCEPTION 'FAIL monotonic refund ledger';END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',outsider,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.stripe_denied(format('SELECT public.ride_payment_state(%L)',ride));EXECUTE 'RESET ROLE';
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride2,city,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',12.34,now()-interval '8 minutes');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride2);EXECUTE 'RESET ROLE';
 o:=private.begin_ride_checkout(ride2,customer,aid);PERFORM private.attach_ride_checkout((o->>'id')::uuid,'cs_live_cancel','https://checkout.stripe.com/c/pay/cs_live_cancel');
 PERFORM private.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_live_cancel',NULL,'evt_expired','canceled',1234,0,0);
 EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.complete_ride_payment(gen_random_uuid(),ride2,duid,'cash');EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.driver_money_entries WHERE request_id=ride2)<>1 THEN RAISE EXCEPTION 'FAIL safe cash fallback';END IF;
END $t$;
ROLLBACK;
