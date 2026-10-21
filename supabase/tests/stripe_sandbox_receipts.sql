-- Only synthetic private sandbox orders, rolled back. Never mutate a real ride.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE FUNCTION pg_temp.stripe_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IN ('42501','P0001','23505','23514','22P02') THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'FAIL forbidden Stripe operation allowed: %',statement;
END $$;
DO $test$
DECLARE root_id uuid:=gen_random_uuid(); city_id uuid:=gen_random_uuid(); foreign_id uuid:=gen_random_uuid();
 order_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); checkout_id uuid:=gen_random_uuid(); evt jsonb; reply jsonb; initial jsonb; before_counts jsonb;
BEGIN
 SELECT jsonb_build_array((SELECT count(*) FROM public.taxi_requests),(SELECT count(*) FROM public.driver_money_entries),
  (SELECT count(*) FROM public.payment_transactions),(SELECT count(*) FROM public.ride_payment_receipts)) INTO before_counts;
 INSERT INTO public.companies(id,name,slug) VALUES(root_id,'Sandbox root','sb-'||root_id),(foreign_id,'Sandbox foreign','sb-'||foreign_id);
 INSERT INTO public.companies(id,name,slug,parent_company_id,service_city,service_latitude,service_longitude,service_radius_km)
 VALUES(city_id,'Sandbox city','sb-'||city_id,root_id,'Търново',43.0757,25.6172,10);
 INSERT INTO private.stripe_sandbox_merchants(account_id,root_company_id,enabled) VALUES('acct_fixture',root_id,true);
 EXECUTE 'SET LOCAL ROLE service_role';
 initial:=public.register_stripe_sandbox_order(order_id,'acct_fixture',city_id,'pi_fixture',1234,'eur');
 IF public.register_stripe_sandbox_order(order_id,'acct_fixture',city_id,'pi_fixture',1234,'eur') IS DISTINCT FROM initial THEN RAISE EXCEPTION 'FAIL order retry'; END IF;
 PERFORM pg_temp.stripe_denied(format('SELECT public.register_stripe_sandbox_order(%L,''acct_fixture'',%L,''pi_foreign'',1234,''eur'')',other_id,foreign_id));
 PERFORM pg_temp.stripe_denied(format('SELECT public.register_stripe_sandbox_order(%L,''acct_fixture'',%L,''pi_changed'',1234,''eur'')',order_id,city_id));
 evt:=jsonb_build_object('account_id','acct_fixture','event_id','evt_paid','type','payment_intent.succeeded','livemode',false,
  'order_id',order_id,'payment_id','pi_fixture','amount_minor',1234,'received_minor',1234,'refunded_minor',0,'currency','eur','state','paid');
 reply:=public.record_stripe_sandbox_event(evt);
 IF reply->>'result'<>'applied_sandbox_only' OR (reply->>'duplicate')::boolean THEN RAISE EXCEPTION 'FAIL first event'; END IF;
 IF NOT (public.record_stripe_sandbox_event(evt)->>'duplicate')::boolean THEN RAISE EXCEPTION 'FAIL duplicate event'; END IF;
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_stripe_sandbox_event(%L)',evt||'{"livemode":true}'));
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_stripe_sandbox_event(%L)',evt||'{"received_minor":1200}'));
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_stripe_sandbox_event(%L)',evt||'{"event_id":"evt_paid","currency":"usd"}'));
 IF public.record_stripe_sandbox_event(evt||'{"event_id":"evt_mismatch","currency":"usd"}')->>'result'<>'rejected_amount_or_currency' THEN RAISE EXCEPTION 'FAIL currency mismatch'; END IF;
 IF public.record_stripe_sandbox_event(evt||'{"event_id":"evt_wrongpi","payment_id":"pi_other"}')->>'result'<>'ignored_unregistered_payment' THEN RAISE EXCEPTION 'FAIL wrong payment binding'; END IF;
 IF public.record_stripe_sandbox_event(evt||jsonb_build_object('event_id','evt_wrongorder','order_id',other_id))->>'result'<>'ignored_unregistered_payment' THEN RAISE EXCEPTION 'FAIL wrong order binding'; END IF;
 IF public.record_stripe_sandbox_event(evt||'{"event_id":"evt_legacy","order_id":null}')->>'result'<>'ignored_unregistered_payment' THEN RAISE EXCEPTION 'FAIL legacy CLI metadata'; END IF;
 PERFORM public.record_stripe_sandbox_event(evt||'{"event_id":"evt_latefailure","type":"payment_intent.payment_failed","state":"failed","received_minor":0}');
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM private.stripe_sandbox_orders WHERE id=order_id AND state='paid' AND received_minor=1234) THEN RAISE EXCEPTION 'FAIL late failure downgraded captured money'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 PERFORM public.record_stripe_sandbox_event(evt||'{"event_id":"evt_partialrefund","type":"refund.updated","refunded_minor":234}');
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM private.stripe_sandbox_orders WHERE id=order_id AND state='partially_refunded' AND refunded_minor=234) THEN RAISE EXCEPTION 'FAIL partial refund'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 PERFORM public.record_stripe_sandbox_event(evt||'{"event_id":"evt_fullrefund","type":"charge.refunded","refunded_minor":1234}');
 IF NOT (public.record_stripe_sandbox_event(evt||'{"event_id":"evt_partialrefund","type":"refund.updated","refunded_minor":1234}')->>'duplicate')::boolean THEN RAISE EXCEPTION 'FAIL duplicate refund after a newer refund'; END IF;
 PERFORM public.record_stripe_sandbox_event(evt||'{"event_id":"evt_latesuccess"}');
 PERFORM public.record_stripe_sandbox_event(evt||'{"event_id":"evt_laterefund","type":"refund.updated","refunded_minor":100}');
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM private.stripe_sandbox_orders WHERE id=order_id AND state='refunded' AND refunded_minor=1234) THEN RAISE EXCEPTION 'FAIL late event reversed refund'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 PERFORM public.register_stripe_sandbox_order(checkout_id,'acct_fixture',city_id,NULL,1234,'eur','cs_test_fixture');
 reply:=public.record_stripe_sandbox_event(evt||jsonb_build_object('event_id','evt_wrongcheckout','order_id',checkout_id,'payment_id','pi_checkout',
  'type','checkout.session.completed','checkout_session_id','cs_test_foreign'));
 IF reply->>'result'<>'ignored_unregistered_payment' THEN RAISE EXCEPTION 'FAIL foreign Checkout binding'; END IF;
 reply:=public.record_stripe_sandbox_event(evt||jsonb_build_object('event_id','evt_checkout','order_id',checkout_id,'payment_id','pi_checkout',
  'type','checkout.session.completed','checkout_session_id','cs_test_fixture'));
 IF reply->>'result'<>'applied_sandbox_only' THEN RAISE EXCEPTION 'FAIL Checkout confirmation'; END IF;
 PERFORM public.register_stripe_sandbox_order(checkout_id,'acct_fixture',city_id,NULL,1234,'eur','cs_test_fixture');
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM private.stripe_sandbox_orders WHERE id=checkout_id AND payment_id='pi_checkout' AND state='paid') THEN RAISE EXCEPTION 'FAIL Checkout payment association'; END IF;
 -- Public wrappers and private tables remain unavailable to customers/drivers/admins.
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_stripe_sandbox_event(%L)',evt));
 PERFORM pg_temp.stripe_denied(format('SELECT public.register_stripe_sandbox_order(%L,''acct_fixture'',%L,''pi_abuse'',1234,''eur'')',other_id,city_id));
 PERFORM pg_temp.stripe_denied('SELECT * FROM private.stripe_sandbox_orders');
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM pg_temp.stripe_denied(format('SELECT public.record_stripe_sandbox_event(%L)',evt));
 EXECUTE 'RESET ROLE';
 IF jsonb_build_array((SELECT count(*) FROM public.taxi_requests),(SELECT count(*) FROM public.driver_money_entries),
  (SELECT count(*) FROM public.payment_transactions),(SELECT count(*) FROM public.ride_payment_receipts)) IS DISTINCT FROM before_counts THEN RAISE EXCEPTION 'FAIL sandbox contaminated real financial tables'; END IF;
 RAISE NOTICE 'PASS: one merchant, city inheritance, strict binding, duplicate events, order/refund monotonicity, private sandbox isolation';
END $test$;
ROLLBACK;
