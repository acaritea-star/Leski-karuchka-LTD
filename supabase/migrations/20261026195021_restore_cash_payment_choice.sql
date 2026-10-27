-- Switching tender must expire the online order before the driver records cash/POS.
-- Existing paid test rides and their accounting remain untouched.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION private.complete_ride_payment(p_id uuid,p_request_id uuid,p_actor uuid,p_choice text,p_partial_amount numeric DEFAULT NULL,p_note text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE result jsonb; r public.taxi_requests;
BEGIN
 IF auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR NOT public.is_driver(r.driver_id) OR NOT EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=r.driver_id AND d.user_id=p_actor AND d.company_id=r.company_id) THEN RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=r.id AND (state<>'canceled' OR received_minor<>0)) THEN
  RAISE EXCEPTION 'ONLINE_PAYMENT_PENDING: first cancel and reconcile the online payment';END IF;
 IF r.payment_environment='test' THEN
  IF r.status<>'in_progress' OR r.payment_status<>'pending' OR NOT EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=r.id AND state='canceled' AND received_minor=0) THEN
   RAISE EXCEPTION 'Test payment cannot become a real receipt';END IF;
  -- No test money is converted: only the explicit manual receipt below records real money.
  -- Any validation failure rolls this environment change back with the receipt.
  UPDATE public.taxi_requests SET payment_environment='live' WHERE id=r.id;
 END IF;
 result:=private.complete_ride_payment_before_online(p_id,p_request_id,p_actor,p_choice,p_partial_amount,p_note);
 UPDATE public.taxi_requests SET trip_ended_at=coalesce(trip_ended_at,completed_at),payment_status=CASE WHEN p_choice IN ('cash','card') THEN 'paid'::public.payment_status ELSE payment_status END WHERE id=p_request_id;
 RETURN jsonb_set(result,'{ride}',(SELECT to_jsonb(t) FROM public.taxi_requests t WHERE id=p_request_id));
END $f$;

-- An Elements order cannot create a Session until its Stripe Customer is bound.
-- Cancel only that pre-initialisation window under the same row lock as binding.
-- If binding won the race, return the order for Stripe expiry/reconciliation.
CREATE FUNCTION private.cancel_uninitialized_ride_checkout(p_order_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; r public.taxi_requests; rid uuid;
BEGIN
 SELECT request_id INTO rid FROM private.ride_stripe_orders WHERE id=p_order_id;
 SELECT * INTO r FROM public.taxi_requests WHERE id=rid FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND p.is_active AND
  (p.id=r.customer_id OR p.role='DRIVER' AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=r.driver_id AND d.user_id=p.id AND d.company_id=p.company_id AND d.company_id=r.company_id))) THEN
  RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF o.ui_mode='elements' AND o.state='creating' AND o.stripe_customer_id IS NULL AND o.checkout_session_id IS NULL AND o.received_minor=0
  AND r.status='in_progress' AND r.payment_status='pending' THEN
  UPDATE private.ride_stripe_orders SET state='canceled',updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
  UPDATE public.taxi_requests SET online_payment_state='canceled',updated_at=clock_timestamp() WHERE id=r.id;
 END IF;
 RETURN to_jsonb(o);
END $f$;
CREATE FUNCTION public.cancel_uninitialized_ride_checkout(p_order_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.cancel_uninitialized_ride_checkout(p_order_id,p_actor); $f$;
REVOKE ALL ON FUNCTION private.cancel_uninitialized_ride_checkout(uuid,uuid),public.cancel_uninitialized_ride_checkout(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.cancel_uninitialized_ride_checkout(uuid,uuid),public.cancel_uninitialized_ride_checkout(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION private.ride_payment_state(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests;m private.ride_stripe_merchants;eligible boolean:=false;environment text;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
  OR NOT(r.customer_id=auth.uid() OR public.is_driver(r.driver_id) OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501';END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id
  WHERE merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF FOUND THEN eligible:=(m.livemode OR EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=r.customer_id AND t.root_company_id=m.root_company_id AND t.enabled));END IF;
 eligible:=eligible AND r.payment_status='pending' AND r.status IN ('accepted','arrived','in_progress');
 environment:=CASE WHEN r.payment_environment='test' OR eligible AND NOT m.livemode THEN 'test' ELSE 'live' END;
 RETURN jsonb_build_object('request_id',r.id,'eligible',eligible,'inline_available',eligible AND m.publishable_key IS NOT NULL,'preparation',CASE WHEN eligible AND m.publishable_key IS NOT NULL AND r.customer_id=auth.uid() THEN jsonb_build_object('account_id',m.account_id,'publishable_key',m.publishable_key,'environment',environment) ELSE NULL END,'environment',environment,'ended_at',r.trip_ended_at,'amount',coalesce(r.final_price,r.estimated_price),'state',r.online_payment_state,'payment_status',r.payment_status,'payment_method',r.payment_method);
END $function$
;

CREATE OR REPLACE FUNCTION private.record_ride_stripe_snapshot(p_order_id uuid,p_account_id text,p_session_id text,p_payment_id text,p_event_id text,p_state text,p_amount_minor bigint,p_received_minor bigint,p_refunded_minor bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; r public.taxi_requests; rid uuid; received bigint; refunded bigint; next_state text; old_event uuid;
BEGIN
 SELECT request_id INTO rid FROM private.ride_stripe_orders WHERE id=p_order_id;
 IF rid IS NULL THEN RETURN jsonb_build_object('result','unregistered'); END IF;
 SELECT * INTO r FROM public.taxi_requests WHERE id=rid FOR UPDATE;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF o.account_id IS DISTINCT FROM p_account_id OR o.checkout_session_id IS DISTINCT FROM p_session_id OR p_session_id IS NULL
  OR p_amount_minor IS DISTINCT FROM o.amount_minor OR (p_payment_id IS NOT NULL AND p_payment_id !~ '^pi_[a-zA-Z0-9]+$')
  OR o.payment_id IS NOT NULL AND o.payment_id IS DISTINCT FROM p_payment_id
  OR p_event_id IS NULL OR length(p_event_id)>200 OR p_received_minor IS NULL OR p_refunded_minor IS NULL
  OR p_received_minor NOT BETWEEN 0 AND o.amount_minor OR p_refunded_minor NOT BETWEEN 0 AND p_received_minor
  OR p_state IS NULL OR p_state NOT IN ('open','processing','canceled','paid') OR p_state='paid' AND (p_received_minor<>o.amount_minor OR p_payment_id IS NULL)
  OR p_state='canceled' AND p_received_minor<>0 OR r.company_id<>o.company_id OR r.customer_id<>o.customer_id OR r.driver_id<>o.driver_id
  OR r.status NOT IN ('in_progress','completed') OR r.trip_ended_at IS NULL OR r.final_price*100<>o.amount_minor THEN RAISE EXCEPTION 'Payment binding rejected'; END IF;
 -- A delayed expiry of an already canceled test order is harmless after a real
 -- manual receipt. Every account/session/amount/actor binding above still applies.
 IF o.livemode IS DISTINCT FROM (r.payment_environment='live') AND NOT
  (NOT o.livemode AND r.payment_environment='live' AND o.state='canceled' AND o.received_minor=0
   AND p_state='canceled' AND p_received_minor=0 AND EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id)) THEN
  RAISE EXCEPTION 'Payment environment binding rejected';END IF;
 SELECT order_id INTO old_event FROM private.ride_stripe_events WHERE account_id=p_account_id AND event_id=p_event_id;
 IF FOUND AND old_event<>o.id THEN RAISE EXCEPTION 'Payment event collision'; END IF;
 received:=greatest(o.received_minor,p_received_minor); refunded:=greatest(o.refunded_minor,p_refunded_minor);
 IF (received>0 OR p_state IN ('open','processing')) AND o.state='canceled' THEN RAISE EXCEPTION 'Canceled checkout changed; reconcile required'; END IF;
 IF received=o.amount_minor THEN
  IF EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=r.id AND kind='income')
   THEN RAISE EXCEPTION 'Another tender was already recorded'; END IF;
  next_state:=CASE WHEN refunded=received THEN 'refunded' WHEN refunded>0 THEN 'partially_refunded' ELSE 'paid' END;
  IF o.livemode THEN
  IF o.received_minor=0 THEN
   INSERT INTO public.payment_transactions(id,request_id,company_id,amount,method,status,provider,provider_ref,paid_at)
   VALUES(o.id,r.id,r.company_id,o.amount_minor/100.0,'online','completed','stripe',p_payment_id,clock_timestamp());
  END IF;
  IF refunded>o.refunded_minor THEN
   INSERT INTO public.payment_transactions(request_id,company_id,amount,method,status,provider,provider_ref,paid_at)
   VALUES(r.id,r.company_id,(refunded-o.refunded_minor)/100.0,'online','refunded','stripe_refund',p_payment_id||':'||refunded,clock_timestamp());
  END IF;
  END IF;
  UPDATE public.taxi_requests SET status='completed',completed_at=coalesce(completed_at,clock_timestamp()),payment_method='online',
   payment_status=CASE WHEN refunded>0 THEN 'refunded'::public.payment_status ELSE 'paid'::public.payment_status END,online_payment_state=next_state,updated_at=clock_timestamp() WHERE id=r.id
   AND (status,payment_method,payment_status,online_payment_state) IS DISTINCT FROM
    ('completed'::public.request_status,'online'::public.payment_method,CASE WHEN refunded>0 THEN 'refunded'::public.payment_status ELSE 'paid'::public.payment_status END,next_state);
 ELSE
  next_state:=CASE WHEN o.state='canceled' THEN o.state ELSE p_state END;
  UPDATE public.taxi_requests SET online_payment_state=next_state,updated_at=clock_timestamp() WHERE id=r.id AND status='in_progress' AND online_payment_state IS DISTINCT FROM next_state
   AND NOT EXISTS(SELECT 1 FROM private.ride_stripe_orders newer WHERE newer.request_id=r.id AND newer.id<>o.id AND newer.state<>'canceled');
 END IF;
 UPDATE private.ride_stripe_orders SET payment_id=coalesce(payment_id,p_payment_id),received_minor=received,refunded_minor=refunded,state=next_state,updated_at=clock_timestamp() WHERE id=o.id
  AND (payment_id,received_minor,refunded_minor,state) IS DISTINCT FROM (coalesce(o.payment_id,p_payment_id),received,refunded,next_state);
 INSERT INTO private.ride_stripe_events(account_id,event_id,order_id) VALUES(p_account_id,p_event_id,o.id) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('result','recorded','state',next_state);
END $f$;

NOTIFY pgrst,'reload schema';
COMMIT;
