-- Disposable database fixtures only. No external payments; every change rolls back.
BEGIN;
SET LOCAL TIME ZONE 'Europe/Sofia';
UPDATE private.app_security SET staff_mfa_enforced=false;
CREATE FUNCTION pg_temp.cash_choice_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $t$
DECLARE company uuid:=gen_random_uuid();duid uuid:=gen_random_uuid();customer uuid:=gen_random_uuid();outsider uuid:=gen_random_uuid();did uuid;vt uuid:=gen_random_uuid();ride uuid;op uuid;o jsonb;result jsonb;choice text;aid text:='acct_cashChoice';received numeric;
BEGIN
 INSERT INTO public.companies(id,name,slug)VALUES(company,'Synthetic cash choice','cash-choice-'||company);
 INSERT INTO private.ride_stripe_merchants(account_id,root_company_id,enabled,livemode,publishable_key)VALUES(aid,company,true,false,'pk_test_cashChoice');
 INSERT INTO auth.users(id,email)SELECT u,'cash-choice-'||u||'@example.invalid' FROM unnest(ARRAY[duid,customer,outsider])t(u);
 UPDATE public.profiles SET role='DRIVER',company_id=company WHERE id=duid;SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 INSERT INTO private.ride_stripe_test_customers VALUES(customer,company,true);
 INSERT INTO public.vehicle_types(id,company_id,name)VALUES(vt,company,'Synthetic');
 FOREACH choice IN ARRAY ARRAY['cash','card','unpaid','partial_cash','partial_card'] LOOP
  ride:=gen_random_uuid();op:=gen_random_uuid();
  INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
  VALUES(ride,company,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',2.97,now()-interval '8 minutes');
  PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride);EXECUTE 'RESET ROLE';
  o:=public.begin_ride_elements_checkout(ride,customer,aid);
  -- Customers and unrelated accounts cannot access this service-only cancellation RPC.
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.cash_choice_denied(format('SELECT public.cancel_uninitialized_ride_checkout(%L,%L)',o->>'id',duid));EXECUTE 'RESET ROLE';
  PERFORM pg_temp.cash_choice_denied(format('SELECT private.cancel_uninitialized_ride_checkout(%L,%L)',o->>'id',outsider));
  EXECUTE 'SET LOCAL ROLE service_role';
  result:=public.cancel_uninitialized_ride_checkout((o->>'id')::uuid,duid);EXECUTE 'RESET ROLE';
  IF result->>'state'<>'canceled' OR result->>'checkout_session_id' IS NOT NULL THEN RAISE EXCEPTION 'FAIL abandoned initialization did not cancel safely';END IF;
  -- A concurrent/late initializer cannot attach a Customer or Session after cancellation.
  PERFORM pg_temp.cash_choice_denied(format('SELECT public.bind_ride_stripe_customer(%L,%L,''cus_tooLate'')',o->>'id',customer));
  PERFORM pg_temp.cash_choice_denied(format('SELECT public.attach_ride_checkout(%L,''cs_test_tooLate'',NULL)',o->>'id'));
  PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM pg_temp.cash_choice_denied(format('SELECT public.complete_ride_payment(%L,%L,%L,''cash'')',op,ride,customer));EXECUTE 'RESET ROLE';
  IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND payment_environment='test') THEN RAISE EXCEPTION 'FAIL denied receipt changed environment';END IF;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
  result:=public.complete_ride_payment(op,ride,duid,choice,CASE WHEN choice LIKE 'partial_%' THEN 1.20 END,CASE WHEN choice IN ('cash','card') THEN '' ELSE 'Synthetic shortfall' END);
  PERFORM public.complete_ride_payment(op,ride,duid,choice,CASE WHEN choice LIKE 'partial_%' THEN 1.20 END,CASE WHEN choice IN ('cash','card') THEN '' ELSE 'Synthetic shortfall' END);
  EXECUTE 'RESET ROLE';
  received:=CASE WHEN choice='unpaid' THEN 0 WHEN choice LIKE 'partial_%' THEN 1.20 ELSE 2.97 END;
  IF result#>>'{ride,payment_environment}'<>'live' OR result#>>'{ride,status}'<>'completed' OR (result#>>'{receipt,received_amount}')::numeric<>received THEN RAISE EXCEPTION 'FAIL manual receipt: %',result;END IF;
  IF (SELECT count(*) FROM public.ride_payment_receipts WHERE request_id=ride)<>1 OR coalesce((SELECT sum(amount) FROM public.driver_money_entries WHERE request_id=ride AND kind='income'),0)<>received THEN RAISE EXCEPTION 'FAIL duplicate/wrong manual ledger';END IF;
  PERFORM pg_temp.cash_choice_denied(format('SELECT public.begin_ride_elements_checkout(%L,%L,%L)',ride,customer,aid));
 END LOOP;
 -- If binding happens first, cancellation must defer to verified Stripe expiry.
 ride:=gen_random_uuid();
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status,estimated_price,started_at)
 VALUES(ride,company,customer,did,vt,43.2,25.6,43.21,25.61,'in_progress',2.97,now()-interval '8 minutes');
 EXECUTE 'SET LOCAL ROLE authenticated';PERFORM public.end_ride_trip(ride);EXECUTE 'RESET ROLE';
 o:=public.begin_ride_elements_checkout(ride,customer,aid);
 PERFORM public.bind_ride_stripe_customer((o->>'id')::uuid,customer,'cus_cashChoice');
 IF public.cancel_uninitialized_ride_checkout((o->>'id')::uuid,duid)->>'state'<>'creating' THEN RAISE EXCEPTION 'FAIL canceled possibly-created Stripe Session';END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.cash_choice_denied(format('SELECT public.complete_ride_payment(%L,%L,%L,''cash'')',gen_random_uuid(),ride,duid));EXECUTE 'RESET ROLE';
 PERFORM public.attach_ride_checkout((o->>'id')::uuid,'cs_test_cashChoice',NULL);
 PERFORM public.record_ride_stripe_snapshot((o->>'id')::uuid,aid,'cs_test_cashChoice','pi_cashChoice','evt_cashChoice_paid','paid',297,297,0);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.cash_choice_denied(format('SELECT public.complete_ride_payment(%L,%L,%L,''cash'')',gen_random_uuid(),ride,duid));EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=ride) OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND payment_environment='test') THEN RAISE EXCEPTION 'FAIL paid test converted into cash';END IF;
END $t$;
ROLLBACK;
