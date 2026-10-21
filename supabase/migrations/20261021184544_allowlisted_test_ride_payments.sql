-- An explicit customer allowlist enables simulated in-app payments only.
-- Test rides have a visible environment and never create real finance postings.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.taxi_requests ADD COLUMN payment_environment text NOT NULL DEFAULT 'live' CHECK(payment_environment IN ('live','test'));
ALTER TABLE private.ride_stripe_merchants DROP CONSTRAINT ride_stripe_merchants_livemode_check;
ALTER TABLE private.ride_stripe_merchants DROP CONSTRAINT ride_stripe_merchants_root_company_id_key;
CREATE UNIQUE INDEX ride_stripe_one_enabled_root ON private.ride_stripe_merchants(root_company_id) WHERE enabled;
ALTER TABLE private.ride_stripe_orders ADD COLUMN livemode boolean NOT NULL DEFAULT true;
ALTER TABLE private.ride_stripe_orders DROP CONSTRAINT ride_stripe_orders_checkout_session_id_check;
ALTER TABLE private.ride_stripe_orders ADD CONSTRAINT ride_stripe_order_session_environment CHECK(checkout_session_id IS NULL OR (livemode AND checkout_session_id ~ '^cs_live_[a-zA-Z0-9]+$') OR (NOT livemode AND checkout_session_id ~ '^cs_test_[a-zA-Z0-9]+$'));
CREATE TABLE private.ride_stripe_test_customers(customer_id uuid NOT NULL REFERENCES public.profiles(id),root_company_id uuid NOT NULL REFERENCES public.companies(id),enabled boolean NOT NULL DEFAULT false,PRIMARY KEY(customer_id,root_company_id));
ALTER TABLE private.ride_stripe_test_customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ride_stripe_test_customers FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.protect_ride_payment_environment() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 IF NEW.payment_environment IS DISTINCT FROM OLD.payment_environment AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN RAISE EXCEPTION 'Payment environment is server controlled' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER protect_ride_payment_environment BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.protect_ride_payment_environment();
REVOKE ALL ON FUNCTION private.protect_ride_payment_environment() FROM PUBLIC,anon,authenticated,service_role;
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
 RETURN jsonb_build_object('request_id',r.id,'eligible',eligible,'environment',environment,'ended_at',r.trip_ended_at,'amount',coalesce(r.final_price,r.estimated_price),'state',r.online_payment_state,'payment_status',r.payment_status,'payment_method',r.payment_method);
END $f$;
CREATE FUNCTION public.ride_checkout_merchant(p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests;m private.ride_stripe_merchants;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER') THEN RAISE EXCEPTION 'Customer ride required' USING ERRCODE='42501';END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id WHERE merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF NOT FOUND OR NOT m.livemode AND NOT EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=p_actor AND t.root_company_id=m.root_company_id AND t.enabled) THEN RAISE EXCEPTION 'Merchant unavailable' USING ERRCODE='42501';END IF;
 RETURN jsonb_build_object('account_id',m.account_id,'livemode',m.livemode);
END $f$;
REVOKE ALL ON FUNCTION public.ride_checkout_merchant(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.ride_checkout_merchant(uuid,uuid) TO service_role;


CREATE OR REPLACE FUNCTION private.begin_ride_checkout(p_request_id uuid,p_actor uuid,p_account_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests; o private.ride_stripe_orders; m private.ride_stripe_merchants;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER')
  THEN RAISE EXCEPTION 'Customer ride required' USING ERRCODE='42501'; END IF;
 IF r.status<>'in_progress' OR r.trip_ended_at IS NULL OR r.final_price IS NULL OR r.final_price<>r.estimated_price OR r.payment_status<>'pending'
  OR EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id) THEN RAISE EXCEPTION 'Trip must end before online payment'; END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id
  WHERE merchant.account_id=p_account_id AND merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF NOT FOUND OR NOT m.livemode AND NOT EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=p_actor AND t.root_company_id=m.root_company_id AND t.enabled) THEN RAISE EXCEPTION 'Online merchant unavailable' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=r.id AND kind='income') THEN RAISE EXCEPTION 'Another tender was recorded';END IF;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE request_id=r.id AND state<>'canceled' FOR UPDATE;
 IF FOUND THEN IF o.livemode<>m.livemode THEN RAISE EXCEPTION 'Reconcile the existing checkout before changing payment mode';END IF;RETURN to_jsonb(o);END IF;
 INSERT INTO private.ride_stripe_orders(request_id,company_id,customer_id,driver_id,account_id,amount_minor,livemode)
 VALUES(r.id,r.company_id,r.customer_id,r.driver_id,p_account_id,(r.final_price*100)::bigint,m.livemode) RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state='creating',payment_environment=CASE WHEN m.livemode THEN 'live' ELSE 'test' END,updated_at=clock_timestamp() WHERE id=r.id;
 RETURN to_jsonb(o);
END $f$;

CREATE OR REPLACE FUNCTION private.attach_ride_checkout(p_order_id uuid,p_session_id text,p_url text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; rid uuid;
BEGIN
 SELECT request_id INTO rid FROM private.ride_stripe_orders WHERE id=p_order_id;
 PERFORM 1 FROM public.taxi_requests WHERE id=rid FOR UPDATE;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR p_session_id IS NULL OR p_session_id !~ CASE WHEN o.livemode THEN '^cs_live_[a-zA-Z0-9]+$' ELSE '^cs_test_[a-zA-Z0-9]+$' END OR p_url IS NULL OR p_url !~ '^https://checkout[.]stripe[.]com/'
  OR o.checkout_session_id IS NOT NULL AND o.checkout_session_id<>p_session_id OR o.state='canceled' THEN RAISE EXCEPTION 'Checkout binding rejected'; END IF;
 UPDATE private.ride_stripe_orders SET checkout_session_id=p_session_id,checkout_url=p_url,state=CASE WHEN state='creating' THEN 'open' ELSE state END,updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state=o.state,updated_at=clock_timestamp() WHERE id=o.request_id AND status='in_progress';
 RETURN to_jsonb(o);
END $f$;

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
   payment_status=CASE WHEN refunded>0 THEN 'refunded'::public.payment_status ELSE 'paid'::public.payment_status END,online_payment_state=next_state,updated_at=clock_timestamp() WHERE id=r.id;
 ELSE
  next_state:=CASE WHEN o.state='canceled' THEN o.state ELSE p_state END;
  UPDATE public.taxi_requests SET online_payment_state=next_state,updated_at=clock_timestamp() WHERE id=r.id AND status='in_progress';
 END IF;
 UPDATE private.ride_stripe_orders SET payment_id=coalesce(payment_id,p_payment_id),received_minor=received,refunded_minor=refunded,state=next_state,updated_at=clock_timestamp() WHERE id=o.id;
 INSERT INTO private.ride_stripe_events(account_id,event_id,order_id) VALUES(p_account_id,p_event_id,o.id) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('result','recorded','state',next_state);
END $f$;

CREATE OR REPLACE FUNCTION private.complete_ride_payment(p_id uuid,p_request_id uuid,p_actor uuid,p_choice text,p_partial_amount numeric DEFAULT NULL,p_note text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=p_request_id AND state<>'canceled') THEN
  RAISE EXCEPTION 'ONLINE_PAYMENT_PENDING: first cancel and reconcile the online payment'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=p_request_id AND payment_environment='test') THEN RAISE EXCEPTION 'Test rides require test online settlement';END IF;
 result:=private.complete_ride_payment_before_online(p_id,p_request_id,p_actor,p_choice,p_partial_amount,p_note);
 UPDATE public.taxi_requests SET trip_ended_at=coalesce(trip_ended_at,completed_at),payment_status=CASE WHEN p_choice IN ('cash','card') THEN 'paid'::public.payment_status ELSE payment_status END WHERE id=p_request_id;
 RETURN jsonb_set(result,'{ride}',(SELECT to_jsonb(r) FROM public.taxi_requests r WHERE id=p_request_id));
END $f$;

CREATE OR REPLACE FUNCTION private.prevent_online_cash_income() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF NEW.kind='income' AND NEW.request_id IS NOT NULL AND (EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=NEW.request_id AND state<>'canceled') OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=NEW.request_id AND payment_environment='test')) THEN
  RAISE EXCEPTION 'Online payments belong to the company, not the driver cash balance'; END IF;
 RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION private.record_request_outcome()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF NEW.payment_environment='test' THEN RETURN NEW;END IF;
 IF NEW.status IN ('completed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.request_outcomes(request_id,company_id,driver_id,driver_user_id,vehicle_id,outcome,previous_status,cancelled_by,cancel_reason,actor_id,occurred_at,accepted_at,started_at,booked_amount,estimated_distance_km)
  SELECT NEW.id,NEW.company_id,NEW.driver_id,d.user_id,d.vehicle_id,NEW.status::text,OLD.status::text,
   NEW.cancelled_by::text,left(coalesce(nullif(btrim(NEW.cancel_reason),''),'not_provided'),500),
   CASE WHEN NEW.cancelled_by='system' THEN NULL ELSE auth.uid() END,
   coalesce(NEW.completed_at,NEW.cancelled_at,clock_timestamp()),NEW.accepted_at,NEW.started_at,
   CASE WHEN NEW.status='completed' THEN NEW.final_price ELSE NULL END,NEW.estimated_distance_km
  FROM (SELECT 1) seed LEFT JOIN public.drivers d ON d.id=NEW.driver_id
  ON CONFLICT(request_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.create_trip_on_complete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_environment='live' AND NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.trips(request_id,company_id,driver_id,customer_id,distance_km,duration_min,total_amount,payment_method,started_at,ended_at)
    VALUES(NEW.id,NEW.company_id,NEW.driver_id,NEW.customer_id,NEW.estimated_distance_km,
      greatest(0,round(extract(epoch FROM (NEW.completed_at-NEW.started_at))/60,1)),NEW.final_price,NEW.payment_method,NEW.started_at,NEW.completed_at)
    ON CONFLICT(request_id) DO NOTHING;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET status=CASE WHEN NEW.status IN ('accepted','arrived','in_progress') THEN 'busy'::public.driver_status
      WHEN is_online THEN 'available'::public.driver_status ELSE 'offline'::public.driver_status END WHERE id=NEW.driver_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.increment_driver_trip_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.payment_environment='live' AND NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET total_trips = total_trips + 1 WHERE id = NEW.driver_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_customers(p_company uuid, p_search text DEFAULT ''::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb; term text:=btrim(coalesce(p_search,''));
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Customer report scope not allowed' USING ERRCODE='42501';
 END IF;
 IF p_page IS NULL OR p_page<0 OR p_page>10000 OR length(term)>80 THEN
   RAISE EXCEPTION 'Invalid customer report page' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
   SELECT p.id,p.first_name,p.last_name,p.phone,p.avatar_url,p.created_at
   FROM public.profiles p WHERE p.company_id=p_company AND p.role='CUSTOMER'
    AND (term='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(term))>0)
 ), page AS (
   SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_page*50
 ), rows AS (
   SELECT p.*,totals.trips AS "totalTrips",totals.amount AS "totalSpent"
   FROM page p CROSS JOIN LATERAL (
     SELECT count(*) trips,coalesce(sum(coalesce(r.final_price,r.estimated_price,0)),0) amount
     FROM public.taxi_requests r WHERE r.company_id=p_company AND r.customer_id=p.id AND r.status='completed' AND r.payment_environment='live'
   ) totals
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matching),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) FROM rows r),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION public.company_dashboard(p_company_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_company_id IS NULL OR (SELECT auth.uid()) IS NULL
  OR NOT ((SELECT public.is_company_admin(p_company_id)) OR (SELECT public.is_super_admin())) THEN
  RAISE EXCEPTION 'Dashboard scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH driver_totals AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE private.fleet_online(d.is_online,p.is_active,l.updated_at,l.position_at,current_timestamp,l.speed)) AS online
  FROM public.drivers d LEFT JOIN public.profiles p ON p.id=d.user_id
   LEFT JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=p_company_id
  WHERE d.company_id=p_company_id
 ), request_totals AS (
  SELECT count(*) FILTER(WHERE status IN ('accepted','arrived','in_progress')
    OR status='pending' AND coalesce(expires_at,created_at+interval '2 minutes')>current_timestamp) AS active,
   count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='cancelled') AS cancelled,
   coalesce(sum(coalesce(final_price,estimated_price,0)) FILTER(WHERE status='completed'),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id AND payment_environment='live'
   AND (driver_id IS NOT NULL OR fare_breakdown->'marketplace' IS NULL)
 ), dates AS (
  SELECT anchor-6+n AS day FROM generate_series(0,6) AS s(n)
 ), daily AS (
  SELECT (completed_at AT TIME ZONE 'Europe/Sofia')::date AS day,count(*) AS orders,
   coalesce(sum(coalesce(final_price,estimated_price,0)),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id AND payment_environment='live' AND status='completed'
   AND completed_at>=((anchor-6)::timestamp AT TIME ZONE 'Europe/Sofia')
   AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia')
  GROUP BY 1
 )
 SELECT jsonb_build_object('stats',jsonb_build_object(
  'totalDrivers',d.total,'onlineDrivers',d.online,'activeOrders',r.active,
  'completedOrders',r.completed,'cancelledOrders',r.cancelled,'totalRevenue',r.revenue),
  'days',(SELECT jsonb_agg(jsonb_build_object('day',dates.day,'orders',coalesce(daily.orders,0),
   'revenue',coalesce(daily.revenue,0)) ORDER BY dates.day) FROM dates LEFT JOIN daily USING(day)))
 INTO result FROM driver_totals d CROSS JOIN request_totals r;
 RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.driver_day_summary(p_driver_id uuid, p_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_driver_id IS NULL OR (SELECT auth.uid()) IS NULL OR NOT (
  (SELECT public.is_driver(p_driver_id)) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id
    AND ((SELECT public.is_company_admin(d.company_id)) OR (SELECT public.is_super_admin())))) THEN
  RAISE EXCEPTION 'Driver summary scope not allowed' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('day',anchor,'trips',count(*),'earnings',coalesce(sum(coalesce(final_price,estimated_price,0)),0))
 INTO result FROM public.taxi_requests WHERE driver_id=p_driver_id AND status='completed' AND payment_environment='live'
  AND completed_at>=(anchor::timestamp AT TIME ZONE 'Europe/Sofia')
  AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia');
 RETURN result;
END;
$function$;

COMMIT;
