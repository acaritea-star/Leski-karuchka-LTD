-- Embedded Checkout reuses one server-owned order and Stripe customer per account/mode.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE private.ride_stripe_merchants ADD COLUMN publishable_key text
 CHECK(publishable_key IS NULL OR (livemode AND publishable_key ~ '^pk_live_[a-zA-Z0-9]+$') OR (NOT livemode AND publishable_key ~ '^pk_test_[a-zA-Z0-9]+$'));
ALTER TABLE private.ride_stripe_orders ADD COLUMN ui_mode text NOT NULL DEFAULT 'hosted' CHECK(ui_mode IN ('hosted','elements'));
ALTER TABLE private.ride_stripe_orders ADD COLUMN stripe_customer_id text CHECK(stripe_customer_id ~ '^cus_[a-zA-Z0-9]+$');
CREATE TABLE private.ride_stripe_customers(
 customer_id uuid NOT NULL REFERENCES public.profiles(id),
 account_id text NOT NULL REFERENCES private.ride_stripe_merchants(account_id),
 livemode boolean NOT NULL,
 stripe_customer_id text NOT NULL CHECK(stripe_customer_id ~ '^cus_[a-zA-Z0-9]+$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(customer_id,account_id,livemode),UNIQUE(account_id,livemode,stripe_customer_id)
);
ALTER TABLE private.ride_stripe_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ride_stripe_customers FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.ride_checkout_merchant(p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests;m private.ride_stripe_merchants;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER') THEN RAISE EXCEPTION 'Customer ride required' USING ERRCODE='42501';END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id WHERE merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF NOT FOUND OR NOT m.livemode AND NOT EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=p_actor AND t.root_company_id=m.root_company_id AND t.enabled) THEN RAISE EXCEPTION 'Merchant unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('account_id',m.account_id,'livemode',m.livemode,'publishable_key',m.publishable_key);
END $f$;
CREATE OR REPLACE FUNCTION private.begin_ride_checkout_ui(p_request_id uuid,p_actor uuid,p_account_id text,p_ui_mode text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests; o private.ride_stripe_orders; m private.ride_stripe_merchants;
BEGIN
 IF p_ui_mode IS NULL OR p_ui_mode NOT IN ('hosted','elements') THEN RAISE EXCEPTION 'Invalid payment UI';END IF;
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER')
  THEN RAISE EXCEPTION 'Customer ride required' USING ERRCODE='42501'; END IF;
 IF r.status<>'in_progress' OR r.trip_ended_at IS NULL OR r.final_price IS NULL OR r.final_price<>r.estimated_price OR r.payment_status<>'pending'
  OR EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id) THEN RAISE EXCEPTION 'Trip must end before online payment'; END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id
  WHERE merchant.account_id=p_account_id AND merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF NOT FOUND OR NOT m.livemode AND NOT EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=p_actor AND t.root_company_id=m.root_company_id AND t.enabled) THEN RAISE EXCEPTION 'Online merchant unavailable' USING ERRCODE='42501';END IF;
 IF p_ui_mode='elements' AND m.publishable_key IS NULL THEN RAISE EXCEPTION 'Embedded payments unavailable';END IF;
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=r.id AND kind='income') THEN RAISE EXCEPTION 'Another tender was recorded';END IF;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE request_id=r.id AND state<>'canceled' FOR UPDATE;
 IF FOUND THEN IF o.livemode<>m.livemode OR o.account_id<>m.account_id THEN RAISE EXCEPTION 'Reconcile the existing checkout before changing payment mode';END IF;RETURN to_jsonb(o);END IF;
 INSERT INTO private.ride_stripe_orders(request_id,company_id,customer_id,driver_id,account_id,amount_minor,livemode,ui_mode,stripe_customer_id)
 VALUES(r.id,r.company_id,r.customer_id,r.driver_id,p_account_id,(r.final_price*100)::bigint,m.livemode,p_ui_mode,CASE WHEN p_ui_mode='elements' THEN (SELECT s.stripe_customer_id FROM private.ride_stripe_customers s WHERE s.customer_id=p_actor AND s.account_id=m.account_id AND s.livemode=m.livemode) END) RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state='creating',payment_environment=CASE WHEN m.livemode THEN 'live' ELSE 'test' END,updated_at=clock_timestamp() WHERE id=r.id;
 RETURN to_jsonb(o);
END $f$;
CREATE OR REPLACE FUNCTION private.begin_ride_checkout(p_request_id uuid,p_actor uuid,p_account_id text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.begin_ride_checkout_ui(p_request_id,p_actor,p_account_id,'hosted'); $f$;
CREATE FUNCTION public.begin_ride_elements_checkout(p_request_id uuid,p_actor uuid,p_account_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.begin_ride_checkout_ui(p_request_id,p_actor,p_account_id,'elements'); $f$;

CREATE FUNCTION private.ride_stripe_customer_context(p_order_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; verified_email text;
BEGIN
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id;
 IF NOT FOUND OR o.customer_id IS DISTINCT FROM p_actor OR o.ui_mode<>'elements' OR o.state NOT IN ('creating','open')
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER') THEN RAISE EXCEPTION 'Customer required' USING ERRCODE='42501';END IF;
 IF o.livemode THEN SELECT email INTO verified_email FROM auth.users WHERE id=p_actor AND email_confirmed_at IS NOT NULL;
 ELSE verified_email:='stripe-test@example.invalid';END IF;
 RETURN jsonb_build_object('email',verified_email);
END $f$;
CREATE FUNCTION public.ride_stripe_customer_context(p_order_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.ride_stripe_customer_context(p_order_id,p_actor); $f$;
CREATE FUNCTION private.bind_ride_stripe_customer(p_order_id uuid,p_actor uuid,p_stripe_customer_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; stored_id text;
BEGIN
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR o.customer_id IS DISTINCT FROM p_actor OR o.ui_mode<>'elements' OR o.state NOT IN ('creating','open')
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER') THEN RAISE EXCEPTION 'Customer required' USING ERRCODE='42501';END IF;
 IF p_stripe_customer_id IS NULL OR p_stripe_customer_id !~ '^cus_[a-zA-Z0-9]+$' THEN RAISE EXCEPTION 'Invalid Stripe customer';END IF;
 INSERT INTO private.ride_stripe_customers(customer_id,account_id,livemode,stripe_customer_id) VALUES(p_actor,o.account_id,o.livemode,p_stripe_customer_id)
 ON CONFLICT(customer_id,account_id,livemode) DO NOTHING;
 SELECT stripe_customer_id INTO stored_id FROM private.ride_stripe_customers WHERE customer_id=p_actor AND account_id=o.account_id AND livemode=o.livemode;
 IF stored_id IS DISTINCT FROM p_stripe_customer_id OR o.stripe_customer_id IS NOT NULL AND o.stripe_customer_id<>stored_id
  OR o.checkout_session_id IS NOT NULL AND o.stripe_customer_id IS NULL THEN RAISE EXCEPTION 'Stripe customer binding rejected';END IF;
 UPDATE private.ride_stripe_orders SET stripe_customer_id=stored_id,updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 RETURN to_jsonb(o);
END $f$;
CREATE FUNCTION public.bind_ride_stripe_customer(p_order_id uuid,p_actor uuid,p_stripe_customer_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.bind_ride_stripe_customer(p_order_id,p_actor,p_stripe_customer_id); $f$;
CREATE OR REPLACE FUNCTION private.attach_ride_checkout(p_order_id uuid,p_session_id text,p_url text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; rid uuid;
BEGIN
 SELECT request_id INTO rid FROM private.ride_stripe_orders WHERE id=p_order_id;
 PERFORM 1 FROM public.taxi_requests WHERE id=rid FOR UPDATE;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR p_session_id IS NULL OR p_session_id !~ (CASE WHEN o.livemode THEN '^cs_live_[a-zA-Z0-9]+$' ELSE '^cs_test_[a-zA-Z0-9]+$' END) OR (o.ui_mode='hosted' AND (p_url IS NULL OR p_url !~ '^https://checkout[.]stripe[.]com/')) OR (o.ui_mode='elements' AND (p_url IS NOT NULL OR o.stripe_customer_id IS NULL))
  OR o.checkout_session_id IS NOT NULL AND o.checkout_session_id<>p_session_id OR o.state='canceled' THEN RAISE EXCEPTION 'Checkout binding rejected'; END IF;
 UPDATE private.ride_stripe_orders SET checkout_session_id=p_session_id,checkout_url=p_url,state=CASE WHEN state='creating' THEN 'open' ELSE state END,updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state=o.state,updated_at=clock_timestamp() WHERE id=o.request_id AND status='in_progress';
 RETURN to_jsonb(o);
END $f$;
CREATE OR REPLACE FUNCTION private.ride_payment_state(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests;m private.ride_stripe_merchants;eligible boolean:=false;environment text;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
  OR NOT(r.customer_id=auth.uid() OR public.is_driver(r.driver_id) OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501';END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id
  WHERE merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF FOUND THEN eligible:=(m.livemode OR EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=r.customer_id AND t.root_company_id=m.root_company_id AND t.enabled));END IF;
 environment:=CASE WHEN r.payment_environment='test' OR eligible AND NOT m.livemode THEN 'test' ELSE 'live' END;
 eligible:=eligible AND r.payment_status='pending' AND r.status IN ('accepted','arrived','in_progress');
 RETURN jsonb_build_object('request_id',r.id,'eligible',eligible,'inline_available',eligible AND m.publishable_key IS NOT NULL,'environment',environment,'ended_at',r.trip_ended_at,'amount',coalesce(r.final_price,r.estimated_price),'state',r.online_payment_state,'payment_status',r.payment_status,'payment_method',r.payment_method);
END $f$;
REVOKE ALL ON FUNCTION private.begin_ride_checkout_ui(uuid,uuid,text,text),public.begin_ride_elements_checkout(uuid,uuid,text),private.ride_stripe_customer_context(uuid,uuid),public.ride_stripe_customer_context(uuid,uuid),private.bind_ride_stripe_customer(uuid,uuid,text),public.bind_ride_stripe_customer(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.begin_ride_checkout_ui(uuid,uuid,text,text),public.begin_ride_elements_checkout(uuid,uuid,text),private.ride_stripe_customer_context(uuid,uuid),public.ride_stripe_customer_context(uuid,uuid),private.bind_ride_stripe_customer(uuid,uuid,text),public.bind_ride_stripe_customer(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
