-- Sandbox ingestion only. No writes to rides, driver money, production payment
-- transactions or notifications. Enabling real payments requires a new migration.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE private.stripe_sandbox_merchants (
 account_id text PRIMARY KEY CHECK(account_id ~ '^acct_[a-zA-Z0-9]+$'),
 root_company_id uuid NOT NULL REFERENCES public.companies(id),
 enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE private.stripe_sandbox_orders (
 id uuid PRIMARY KEY,
 account_id text NOT NULL REFERENCES private.stripe_sandbox_merchants(account_id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 payment_id text CHECK(payment_id ~ '^pi_[a-zA-Z0-9]+$'),
 checkout_session_id text CHECK(checkout_session_id ~ '^cs_test_[a-zA-Z0-9]+$'),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000),
 currency text NOT NULL CHECK(currency='eur'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','failed','canceled','paid','partially_refunded','refunded')),
 received_minor bigint NOT NULL DEFAULT 0 CHECK(received_minor>=0 AND received_minor<=amount_minor),
 refunded_minor bigint NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=received_minor),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,payment_id),
 UNIQUE(account_id,checkout_session_id),
 CHECK(payment_id IS NOT NULL OR checkout_session_id IS NOT NULL)
);
CREATE INDEX stripe_sandbox_orders_company_idx ON private.stripe_sandbox_orders(company_id);
CREATE TABLE private.stripe_sandbox_events (
 account_id text NOT NULL REFERENCES private.stripe_sandbox_merchants(account_id),
 event_id text NOT NULL CHECK(event_id ~ '^evt_[a-zA-Z0-9]+$'),
 -- An allowlisted normalized summary; never card data, client_secret or full payloads.
 summary jsonb NOT NULL,
 result text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,event_id)
);
ALTER TABLE private.stripe_sandbox_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.stripe_sandbox_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.stripe_sandbox_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.stripe_sandbox_merchants,private.stripe_sandbox_orders,private.stripe_sandbox_events FROM PUBLIC,anon,authenticated,service_role;

-- Register BEFORE confirming a sandbox PaymentIntent. Metadata alone can never
-- create an order or authorize money. A city inherits its root's Stripe merchant.
CREATE FUNCTION private.register_stripe_sandbox_order(p_id uuid,p_account_id text,p_company_id uuid,p_payment_id text,p_amount_minor bigint,p_currency text,p_checkout_session_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m private.stripe_sandbox_merchants; o private.stripe_sandbox_orders;
BEGIN
 SELECT * INTO m FROM private.stripe_sandbox_merchants WHERE account_id=p_account_id AND enabled;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_company_id
  AND (c.id=m.root_company_id OR c.parent_company_id=m.root_company_id) AND lower(c.currency)=p_currency)
 THEN RAISE EXCEPTION 'Sandbox company or merchant not allowed' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR (p_payment_id IS NULL AND p_checkout_session_id IS NULL)
  OR (p_payment_id IS NOT NULL AND p_payment_id !~ '^pi_[a-zA-Z0-9]+$')
  OR (p_checkout_session_id IS NOT NULL AND p_checkout_session_id !~ '^cs_test_[a-zA-Z0-9]+$') OR p_currency IS DISTINCT FROM 'eur'
  OR p_amount_minor IS NULL OR p_amount_minor NOT BETWEEN 1 AND 100000000 THEN RAISE EXCEPTION 'Invalid sandbox order'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('stripe-order:'||p_id::text,0));
 SELECT * INTO o FROM private.stripe_sandbox_orders WHERE id=p_id;
 IF FOUND THEN
  IF (o.account_id,o.company_id,o.amount_minor,o.currency,o.checkout_session_id) IS DISTINCT FROM
   (p_account_id,p_company_id,p_amount_minor,p_currency,p_checkout_session_id)
   OR (p_payment_id IS NOT NULL AND o.payment_id IS DISTINCT FROM p_payment_id)
   THEN RAISE EXCEPTION 'Sandbox order ID already used' USING ERRCODE='23505'; END IF;
 ELSE
  INSERT INTO private.stripe_sandbox_orders(id,account_id,company_id,payment_id,amount_minor,currency,checkout_session_id)
  VALUES(p_id,p_account_id,p_company_id,p_payment_id,p_amount_minor,p_currency,p_checkout_session_id) RETURNING * INTO o;
 END IF;
 RETURN to_jsonb(o);
END $fn$;
CREATE FUNCTION public.register_stripe_sandbox_order(p_id uuid,p_account_id text,p_company_id uuid,p_payment_id text,p_amount_minor bigint,p_currency text,p_checkout_session_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.register_stripe_sandbox_order(p_id,p_account_id,p_company_id,p_payment_id,p_amount_minor,p_currency,p_checkout_session_id);
$fn$;

CREATE FUNCTION private.record_stripe_sandbox_event(p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE m private.stripe_sandbox_merchants; o private.stripe_sandbox_orders; old_event private.stripe_sandbox_events;
 eid text:=p_event->>'event_id'; aid text:=p_event->>'account_id'; pid text:=p_event->>'payment_id';
 amount bigint; received bigint; refunded bigint; next_state text:=p_event->>'state'; result text; oid uuid;
BEGIN
 IF p_event IS NULL OR jsonb_typeof(p_event)<>'object' OR coalesce(p_event->>'livemode','')<>'false'
  OR eid IS NULL OR eid !~ '^evt_[a-zA-Z0-9]+$' OR pid IS NULL OR pid !~ '^pi_[a-zA-Z0-9]+$'
  OR next_state IS NULL OR next_state NOT IN ('pending','processing','failed','canceled','paid')
  OR coalesce(p_event->>'type','') NOT IN ('payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed',
   'payment_intent.canceled','payment_intent.created','payment_intent.requires_action','payment_intent.amount_capturable_updated',
   'payment_intent.partially_funded','refund.created','refund.updated','refund.failed','charge.refunded',
   'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed')
 THEN RAISE EXCEPTION 'Invalid sandbox event'; END IF;
 SELECT * INTO m FROM private.stripe_sandbox_merchants WHERE account_id=aid AND enabled;
 IF NOT FOUND THEN RAISE EXCEPTION 'Sandbox merchant not enabled' USING ERRCODE='42501'; END IF;
 amount:=(p_event->>'amount_minor')::bigint; received:=(p_event->>'received_minor')::bigint; refunded:=(p_event->>'refunded_minor')::bigint;
 IF amount IS NULL OR amount NOT BETWEEN 1 AND 100000000 OR received IS NULL OR received<0 OR received>amount
  OR refunded IS NULL OR refunded<0 OR refunded>received OR coalesce(p_event->>'currency','') !~ '^[a-z]{3}$'
  OR (next_state='paid' AND received<>amount) THEN RAISE EXCEPTION 'Invalid sandbox payment amount'; END IF;
 -- Serialize event retries, then lock the immutable order for different events
 -- concerning the same payment. Both operations commit or both roll back.
 PERFORM pg_advisory_xact_lock(hashtextextended('stripe-event:'||aid||':'||eid,0));
 SELECT * INTO old_event FROM private.stripe_sandbox_events WHERE account_id=aid AND event_id=eid;
 IF FOUND THEN
  -- Refund reconciliation reads current Stripe totals. Those three fields may
  -- advance between deliveries of the same immutable event; never reapply it.
  IF (old_event.summary-ARRAY['received_minor','refunded_minor','state']) IS DISTINCT FROM
   (p_event-ARRAY['received_minor','refunded_minor','state']) THEN RAISE EXCEPTION 'Stripe event ID collision' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('result',old_event.result,'duplicate',true);
 END IF;
 oid:=nullif(p_event->>'order_id','')::uuid;
 SELECT * INTO o FROM private.stripe_sandbox_orders WHERE id=oid AND account_id=aid AND
  (payment_id=pid OR (payment_id IS NULL AND checkout_session_id=p_event->>'checkout_session_id'
   AND p_event->>'type' IN ('checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed')))
  AND (p_event->>'checkout_session_id' IS NULL OR checkout_session_id=p_event->>'checkout_session_id') FOR UPDATE;
 IF NOT FOUND THEN result:='ignored_unregistered_payment';
 ELSIF NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=o.company_id AND
  (c.id=m.root_company_id OR c.parent_company_id=m.root_company_id)) THEN result:='rejected_company';
 ELSIF o.amount_minor<>amount OR o.currency IS DISTINCT FROM p_event->>'currency' THEN result:='rejected_amount_or_currency';
 ELSE
  received:=greatest(received,o.received_minor); refunded:=greatest(refunded,o.refunded_minor);
  UPDATE private.stripe_sandbox_orders SET payment_id=pid,received_minor=received,refunded_minor=refunded,
   state=CASE WHEN refunded=amount THEN 'refunded' WHEN refunded>0 THEN 'partially_refunded'
    WHEN received=amount AND (next_state='paid' OR o.state='paid') THEN 'paid'
    WHEN o.state IN ('paid','partially_refunded','refunded','canceled') THEN o.state ELSE next_state END,
   updated_at=clock_timestamp() WHERE id=o.id;
  result:='applied_sandbox_only';
 END IF;
 INSERT INTO private.stripe_sandbox_events(account_id,event_id,summary,result) VALUES(aid,eid,p_event,result);
 RETURN jsonb_build_object('result',result,'duplicate',false);
END $fn$;
CREATE FUNCTION public.record_stripe_sandbox_event(p_event jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.record_stripe_sandbox_event(p_event);
$fn$;
REVOKE ALL ON FUNCTION private.register_stripe_sandbox_order(uuid,text,uuid,text,bigint,text,text),public.register_stripe_sandbox_order(uuid,text,uuid,text,bigint,text,text),
 private.record_stripe_sandbox_event(jsonb),public.record_stripe_sandbox_event(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.register_stripe_sandbox_order(uuid,text,uuid,text,bigint,text,text),public.register_stripe_sandbox_order(uuid,text,uuid,text,bigint,text,text),
 private.record_stripe_sandbox_event(jsonb),public.record_stripe_sandbox_event(jsonb) TO service_role;
COMMIT;
