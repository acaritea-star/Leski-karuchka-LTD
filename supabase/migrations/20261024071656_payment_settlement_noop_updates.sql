-- Keep settlement, locking, binding, refund and ledger rules unchanged.
-- Audit each event, but publish row changes only when payment data changes.
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
  OR o.livemode IS DISTINCT FROM (r.payment_environment='live') OR r.status NOT IN ('in_progress','completed') OR r.trip_ended_at IS NULL OR r.final_price*100<>o.amount_minor THEN RAISE EXCEPTION 'Payment binding rejected'; END IF;
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
  UPDATE public.taxi_requests SET online_payment_state=next_state,updated_at=clock_timestamp() WHERE id=r.id AND status='in_progress' AND online_payment_state IS DISTINCT FROM next_state;
 END IF;
 UPDATE private.ride_stripe_orders SET payment_id=coalesce(payment_id,p_payment_id),received_minor=received,refunded_minor=refunded,state=next_state,updated_at=clock_timestamp() WHERE id=o.id
  AND (payment_id,received_minor,refunded_minor,state) IS DISTINCT FROM (coalesce(o.payment_id,p_payment_id),received,refunded,next_state);
 INSERT INTO private.ride_stripe_events(account_id,event_id,order_id) VALUES(p_account_id,p_event_id,o.id) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('result','recorded','state',next_state);
END $f$;
