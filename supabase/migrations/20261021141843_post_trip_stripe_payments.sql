-- The trip ends before payment. Only a registered merchant and a server-created
-- Checkout can settle it online. Sandbox ingestion remains completely separate.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.taxi_requests ADD COLUMN trip_ended_at timestamptz;
ALTER TABLE public.taxi_requests ADD COLUMN online_payment_state text NOT NULL DEFAULT 'none'
 CHECK(online_payment_state IN ('none','creating','open','processing','canceled','paid','partially_refunded','refunded'));
CREATE TABLE private.ride_stripe_merchants(
 account_id text PRIMARY KEY CHECK(account_id ~ '^acct_[a-zA-Z0-9]+$'),
 root_company_id uuid NOT NULL REFERENCES public.companies(id),
 enabled boolean NOT NULL DEFAULT false,
 livemode boolean NOT NULL DEFAULT true CHECK(livemode),
 UNIQUE(root_company_id)
);
CREATE TABLE private.ride_stripe_orders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.taxi_requests(id),
 company_id uuid NOT NULL REFERENCES public.companies(id), customer_id uuid NOT NULL, driver_id uuid NOT NULL,
 account_id text NOT NULL REFERENCES private.ride_stripe_merchants(account_id),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 100000000), currency text NOT NULL DEFAULT 'eur' CHECK(currency='eur'),
 checkout_session_id text UNIQUE CHECK(checkout_session_id ~ '^cs_live_[a-zA-Z0-9]+$'),
 payment_id text UNIQUE CHECK(payment_id ~ '^pi_[a-zA-Z0-9]+$'), checkout_url text,
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','open','processing','canceled','paid','partially_refunded','refunded')),
 received_minor bigint NOT NULL DEFAULT 0 CHECK(received_minor BETWEEN 0 AND amount_minor),
 refunded_minor bigint NOT NULL DEFAULT 0 CHECK(refunded_minor BETWEEN 0 AND received_minor),
 expires_at bigint NOT NULL DEFAULT extract(epoch FROM clock_timestamp()+interval '35 minutes')::bigint,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX ride_stripe_one_payment ON private.ride_stripe_orders(request_id) WHERE state<>'canceled';
CREATE INDEX ride_stripe_orders_company_idx ON private.ride_stripe_orders(company_id);
CREATE TABLE private.ride_stripe_events(account_id text NOT NULL,event_id text NOT NULL,order_id uuid NOT NULL REFERENCES private.ride_stripe_orders(id),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,event_id));
ALTER TABLE private.ride_stripe_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ride_stripe_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.ride_stripe_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ride_stripe_merchants,private.ride_stripe_orders,private.ride_stripe_events FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX payment_transactions_stripe_ref_idx ON public.payment_transactions(provider,provider_ref) WHERE provider IN ('stripe','stripe_refund');
-- No company administrator or customer can manufacture a Stripe confirmation.
REVOKE INSERT,UPDATE,DELETE ON public.payment_transactions FROM anon,authenticated;

CREATE FUNCTION private.ride_payment_state(p_request_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests; eligible boolean;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
  OR NOT(r.customer_id=auth.uid() OR public.is_driver(r.driver_id) OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM private.ride_stripe_merchants m JOIN public.companies c ON c.id=r.company_id
  WHERE m.enabled AND (c.id=m.root_company_id OR c.parent_company_id=m.root_company_id) AND lower(c.currency)='eur') INTO eligible;
 RETURN jsonb_build_object('request_id',r.id,'eligible',eligible,'ended_at',r.trip_ended_at,'amount',coalesce(r.final_price,r.estimated_price),
  'state',r.online_payment_state,'payment_status',r.payment_status,'payment_method',r.payment_method);
END $f$;
CREATE FUNCTION public.ride_payment_state(p_request_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$ SELECT private.ride_payment_state(p_request_id); $f$;
CREATE FUNCTION private.end_ride_trip(p_request_id uuid) RETURNS public.taxi_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR NOT public.is_driver(r.driver_id) THEN RAISE EXCEPTION 'Assigned driver required' USING ERRCODE='42501'; END IF;
 IF r.trip_ended_at IS NOT NULL THEN RETURN r; END IF;
 IF r.status<>'in_progress' OR r.estimated_price IS NULL OR r.estimated_price<=0 OR r.estimated_price>1000000 OR r.estimated_price<>round(r.estimated_price,2) THEN RAISE EXCEPTION 'Ride is not ready to end'; END IF;
 UPDATE public.taxi_requests SET trip_ended_at=clock_timestamp(),final_price=estimated_price,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 RETURN r;
END $f$;
CREATE FUNCTION public.end_ride_trip(p_request_id uuid) RETURNS public.taxi_requests LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$ SELECT private.end_ride_trip(p_request_id); $f$;
REVOKE ALL ON FUNCTION private.ride_payment_state(uuid),public.ride_payment_state(uuid),private.end_ride_trip(uuid),public.end_ride_trip(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.ride_payment_state(uuid),public.ride_payment_state(uuid),private.end_ride_trip(uuid),public.end_ride_trip(uuid) TO authenticated;

CREATE FUNCTION private.begin_ride_checkout(p_request_id uuid,p_actor uuid,p_account_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests; o private.ride_stripe_orders;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR r.customer_id IS DISTINCT FROM p_actor OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND is_active AND role='CUSTOMER')
  THEN RAISE EXCEPTION 'Customer ride required' USING ERRCODE='42501'; END IF;
 IF r.status<>'in_progress' OR r.trip_ended_at IS NULL OR r.final_price IS NULL OR r.final_price<>r.estimated_price OR r.payment_status<>'pending'
  OR EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id) THEN RAISE EXCEPTION 'Trip must end before online payment'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.ride_stripe_merchants m JOIN public.companies c ON c.id=r.company_id
  WHERE m.account_id=p_account_id AND m.enabled AND m.livemode AND (c.id=m.root_company_id OR c.parent_company_id=m.root_company_id) AND lower(c.currency)='eur')
  THEN RAISE EXCEPTION 'Online merchant unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE request_id=r.id AND state<>'canceled' FOR UPDATE;
 IF FOUND THEN RETURN to_jsonb(o); END IF;
 INSERT INTO private.ride_stripe_orders(request_id,company_id,customer_id,driver_id,account_id,amount_minor)
 VALUES(r.id,r.company_id,r.customer_id,r.driver_id,p_account_id,(r.final_price*100)::bigint) RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state='creating',updated_at=clock_timestamp() WHERE id=r.id;
 RETURN to_jsonb(o);
END $f$;
CREATE FUNCTION public.begin_ride_checkout(p_request_id uuid,p_actor uuid,p_account_id text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$ SELECT private.begin_ride_checkout(p_request_id,p_actor,p_account_id); $f$;

CREATE FUNCTION private.read_ride_checkout(p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE r public.taxi_requests; o private.ride_stripe_orders;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND p.is_active AND
  (p.id=r.customer_id OR p.role='DRIVER' AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=r.driver_id AND d.user_id=p.id AND d.company_id=p.company_id))) THEN
  RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE request_id=r.id ORDER BY created_at DESC LIMIT 1;
 RETURN CASE WHEN FOUND THEN to_jsonb(o) ELSE NULL END;
END $f$;
CREATE FUNCTION public.read_ride_checkout(p_request_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$ SELECT private.read_ride_checkout(p_request_id,p_actor); $f$;
CREATE FUNCTION public.lookup_ride_checkout(p_order_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$ SELECT to_jsonb(o) FROM private.ride_stripe_orders o WHERE id=p_order_id; $f$;

CREATE FUNCTION private.attach_ride_checkout(p_order_id uuid,p_session_id text,p_url text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE o private.ride_stripe_orders; rid uuid;
BEGIN
 SELECT request_id INTO rid FROM private.ride_stripe_orders WHERE id=p_order_id;
 PERFORM 1 FROM public.taxi_requests WHERE id=rid FOR UPDATE;
 SELECT * INTO o FROM private.ride_stripe_orders WHERE id=p_order_id FOR UPDATE;
 IF NOT FOUND OR p_session_id IS NULL OR p_session_id !~ '^cs_live_[a-zA-Z0-9]+$' OR p_url IS NULL OR p_url !~ '^https://checkout[.]stripe[.]com/'
  OR o.checkout_session_id IS NOT NULL AND o.checkout_session_id<>p_session_id OR o.state='canceled' THEN RAISE EXCEPTION 'Checkout binding rejected'; END IF;
 UPDATE private.ride_stripe_orders SET checkout_session_id=p_session_id,checkout_url=p_url,state=CASE WHEN state='creating' THEN 'open' ELSE state END,updated_at=clock_timestamp() WHERE id=o.id RETURNING * INTO o;
 UPDATE public.taxi_requests SET online_payment_state=o.state,updated_at=clock_timestamp() WHERE id=o.request_id AND status='in_progress';
 RETURN to_jsonb(o);
END $f$;
CREATE FUNCTION public.attach_ride_checkout(p_order_id uuid,p_session_id text,p_url text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$ SELECT private.attach_ride_checkout(p_order_id,p_session_id,p_url); $f$;

CREATE FUNCTION private.record_ride_stripe_snapshot(p_order_id uuid,p_account_id text,p_session_id text,p_payment_id text,p_event_id text,p_state text,p_amount_minor bigint,p_received_minor bigint,p_refunded_minor bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
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
 SELECT order_id INTO old_event FROM private.ride_stripe_events WHERE account_id=p_account_id AND event_id=p_event_id;
 IF FOUND AND old_event<>o.id THEN RAISE EXCEPTION 'Payment event collision'; END IF;
 received:=greatest(o.received_minor,p_received_minor); refunded:=greatest(o.refunded_minor,p_refunded_minor);
 IF (received>0 OR p_state IN ('open','processing')) AND o.state='canceled' THEN RAISE EXCEPTION 'Canceled checkout changed; reconcile required'; END IF;
 IF received=o.amount_minor THEN
  IF EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=r.id) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE request_id=r.id AND kind='income')
   THEN RAISE EXCEPTION 'Another tender was already recorded'; END IF;
  next_state:=CASE WHEN refunded=received THEN 'refunded' WHEN refunded>0 THEN 'partially_refunded' ELSE 'paid' END;
  IF o.received_minor=0 THEN
   INSERT INTO public.payment_transactions(id,request_id,company_id,amount,method,status,provider,provider_ref,paid_at)
   VALUES(o.id,r.id,r.company_id,o.amount_minor/100.0,'online','completed','stripe',p_payment_id,clock_timestamp());
  END IF;
  IF refunded>o.refunded_minor THEN
   INSERT INTO public.payment_transactions(request_id,company_id,amount,method,status,provider,provider_ref,paid_at)
   VALUES(r.id,r.company_id,(refunded-o.refunded_minor)/100.0,'online','refunded','stripe_refund',p_payment_id||':'||refunded,clock_timestamp());
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
CREATE FUNCTION public.record_ride_stripe_snapshot(p_order_id uuid,p_account_id text,p_session_id text,p_payment_id text,p_event_id text,p_state text,p_amount_minor bigint,p_received_minor bigint,p_refunded_minor bigint) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.record_ride_stripe_snapshot(p_order_id,p_account_id,p_session_id,p_payment_id,p_event_id,p_state,p_amount_minor,p_received_minor,p_refunded_minor); $f$;
REVOKE ALL ON FUNCTION private.begin_ride_checkout(uuid,uuid,text),public.begin_ride_checkout(uuid,uuid,text),private.read_ride_checkout(uuid,uuid),public.read_ride_checkout(uuid,uuid),public.lookup_ride_checkout(uuid),private.attach_ride_checkout(uuid,text,text),public.attach_ride_checkout(uuid,text,text),private.record_ride_stripe_snapshot(uuid,text,text,text,text,text,bigint,bigint,bigint),public.record_ride_stripe_snapshot(uuid,text,text,text,text,text,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.begin_ride_checkout(uuid,uuid,text),public.begin_ride_checkout(uuid,uuid,text),private.read_ride_checkout(uuid,uuid),public.read_ride_checkout(uuid,uuid),public.lookup_ride_checkout(uuid),private.attach_ride_checkout(uuid,text,text),public.attach_ride_checkout(uuid,text,text),private.record_ride_stripe_snapshot(uuid,text,text,text,text,text,bigint,bigint,bigint),public.record_ride_stripe_snapshot(uuid,text,text,text,text,text,bigint,bigint,bigint) TO service_role;

-- Serialize cash/POS with the same ride lock as Checkout and webhook settlement.
ALTER FUNCTION private.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) RENAME TO complete_ride_payment_before_online;
CREATE FUNCTION private.complete_ride_payment(p_id uuid,p_request_id uuid,p_actor uuid,p_choice text,p_partial_amount numeric DEFAULT NULL,p_note text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE result jsonb;
BEGIN
 PERFORM 1 FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=p_request_id AND state<>'canceled') THEN
  RAISE EXCEPTION 'ONLINE_PAYMENT_PENDING: first cancel and reconcile the online payment'; END IF;
 result:=private.complete_ride_payment_before_online(p_id,p_request_id,p_actor,p_choice,p_partial_amount,p_note);
 UPDATE public.taxi_requests SET trip_ended_at=coalesce(trip_ended_at,completed_at),payment_status=CASE WHEN p_choice IN ('cash','card') THEN 'paid'::public.payment_status ELSE payment_status END WHERE id=p_request_id;
 RETURN jsonb_set(result,'{ride}',(SELECT to_jsonb(r) FROM public.taxi_requests r WHERE id=p_request_id));
END $f$;
REVOKE ALL ON FUNCTION private.complete_ride_payment_before_online(uuid,uuid,uuid,text,numeric,text),private.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) TO authenticated;
CREATE FUNCTION private.prevent_online_cash_income() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF NEW.kind='income' AND NEW.request_id IS NOT NULL AND EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=NEW.request_id AND state<>'canceled') THEN
  RAISE EXCEPTION 'Online payments belong to the company, not the driver cash balance'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER prevent_online_cash_income BEFORE INSERT ON public.driver_money_entries FOR EACH ROW EXECUTE FUNCTION private.prevent_online_cash_income();
REVOKE ALL ON FUNCTION private.prevent_online_cash_income() FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.prevent_cancel_during_online_payment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF NEW.status='cancelled' AND OLD.status='in_progress' AND EXISTS(SELECT 1 FROM private.ride_stripe_orders WHERE request_id=OLD.id AND state<>'canceled') THEN
  RAISE EXCEPTION 'Cancel and reconcile the online payment before canceling this ride'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER prevent_cancel_during_online_payment BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.prevent_cancel_during_online_payment();
REVOKE ALL ON FUNCTION private.prevent_cancel_during_online_payment() FROM PUBLIC,anon,authenticated,service_role;
ALTER FUNCTION private.accounting_report_v3(date,date,uuid,uuid,integer,boolean,boolean) RENAME TO accounting_report_before_online;
CREATE FUNCTION private.accounting_report_v3(p_from date,p_until date,p_company_id uuid,p_driver_id uuid,p_page integer,p_export boolean,p_summary boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE result jsonb; cid uuid; online jsonb; rec jsonb; missing bigint;
BEGIN
 result:=private.accounting_report_before_online(p_from,p_until,p_company_id,p_driver_id,p_page,p_export,p_summary);
 cid:=(result#>>'{scope,company_id}')::uuid;
 SELECT jsonb_build_object('received',coalesce(sum(t.amount) FILTER(WHERE t.provider='stripe'),0),
  'refunded',coalesce(sum(t.amount) FILTER(WHERE t.provider='stripe_refund'),0),
  'net',coalesce(sum(CASE WHEN t.provider='stripe_refund' THEN -t.amount ELSE t.amount END),0)) INTO online
 FROM public.payment_transactions t JOIN public.taxi_requests r ON r.id=t.request_id
 WHERE t.company_id=cid AND (p_driver_id IS NULL OR r.driver_id=p_driver_id) AND t.provider IN ('stripe','stripe_refund')
  AND t.paid_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND t.paid_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia';
 SELECT coalesce(jsonb_agg(x.value||jsonb_build_object('online_received',coalesce(t.received,0),'online_refunded',coalesce(t.refunded,0),
  'outstanding',CASE WHEN t.received>0 THEN 0 ELSE (x.value->>'outstanding')::numeric END,
  'difference',CASE WHEN t.received>0 THEN coalesce((x.value->>'declared_income')::numeric,0)+t.received-t.refunded-(x.value->>'estimated_amount')::numeric ELSE (x.value->>'difference')::numeric END,
  'payment_method',CASE WHEN t.received>0 THEN 'online' ELSE x.value->>'payment_method' END,
  'company_confirmed',CASE WHEN t.received>0 THEN true ELSE (x.value->>'company_confirmed')::boolean END)), '[]'::jsonb) INTO rec
 FROM jsonb_array_elements(result->'reconciliation') x(value) LEFT JOIN LATERAL(
  SELECT coalesce(sum(p.amount) FILTER(WHERE p.provider='stripe'),0) received,coalesce(sum(p.amount) FILTER(WHERE p.provider='stripe_refund'),0) refunded
  FROM public.payment_transactions p WHERE p.request_id=(x.value->>'request_id')::uuid AND p.provider IN ('stripe','stripe_refund')
 ) t ON true;
 SELECT count(*) INTO missing FROM public.request_outcomes o WHERE o.company_id=cid AND o.outcome='completed'
  AND (p_driver_id IS NULL OR o.driver_id=p_driver_id) AND o.occurred_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND o.occurred_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
  AND EXISTS(SELECT 1 FROM public.payment_transactions p WHERE p.request_id=o.request_id AND p.provider='stripe' AND p.status='completed')
  AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries e WHERE e.request_id=o.request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal'));
 result:=jsonb_set(result,'{totals,unreported_completed}',to_jsonb(greatest(0,(result#>>'{totals,unreported_completed}')::bigint-missing)));
 RETURN result||jsonb_build_object('online_funds',online,'reconciliation',rec);
END $f$;
REVOKE ALL ON FUNCTION private.accounting_report_v3(date,date,uuid,uuid,integer,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.accounting_report_v3(date,date,uuid,uuid,integer,boolean,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION private.company_group_report(p_parent uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_company_admin(p_parent) OR public.is_super_admin()) OR NOT EXISTS(
  SELECT 1 FROM public.companies WHERE id=p_parent AND parent_company_id IS NULL) THEN
  RAISE EXCEPTION 'Общият отчет изисква достъп до основната фирма.' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until) OR p_until<=p_from OR p_until-p_from>366 THEN
  RAISE EXCEPTION 'Изберете валиден период до една година.'; END IF;
 WITH reports AS MATERIALIZED (
  SELECT c.id,c.name,c.service_city,c.parent_company_id,c.is_active,
   private.accounting_report_v3(p_from,p_until,c.id,NULL,0,false,true) report
  FROM public.companies c WHERE c.id=p_parent OR c.parent_company_id=p_parent
 ), rows AS MATERIALIZED (
  SELECT id,name,service_city,parent_company_id,is_active,
   jsonb_build_object('completed',(report->'totals'->>'completed')::bigint,
    'cancelled',(report->'totals'->>'cancelled')::bigint,
    'online_income',(report#>>'{online_funds,net}')::numeric,
    'income',(report->'finances'->>'income')::numeric,
    'expenses',(report->'finances'->>'expenses')::numeric,
    'handed_over',(report->'finances'->>'handed_over')::numeric,
    'cash_income',(report->'payment_breakdown'->>'cash_income')::numeric,
    'card_income',(report->'payment_breakdown'->>'card_income')::numeric,
    'unknown_income',(report->'payment_breakdown'->>'unknown_income')::numeric,
    'cash_closing',(report->'payment_breakdown'->>'cash_closing')::numeric) summary
  FROM reports
 ) SELECT jsonb_build_object('report_version',1,'parent_company_id',p_parent,'currency','EUR',
  'period',jsonb_build_object('from',p_from,'until',p_until,'timezone','Europe/Sofia'),'generated_at',statement_timestamp(),
  'companies',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY parent_company_id NULLS FIRST,name,id) FROM rows r),'[]'::jsonb),
  'total',(SELECT jsonb_build_object('completed',sum((summary->>'completed')::bigint),'cancelled',sum((summary->>'cancelled')::bigint),
   'online_income',sum((summary->>'online_income')::numeric),
   'income',sum((summary->>'income')::numeric),'expenses',sum((summary->>'expenses')::numeric),'handed_over',sum((summary->>'handed_over')::numeric),
   'cash_income',sum((summary->>'cash_income')::numeric),'card_income',sum((summary->>'card_income')::numeric),
   'unknown_income',sum((summary->>'unknown_income')::numeric),'cash_closing',sum((summary->>'cash_closing')::numeric)) FROM rows)) INTO result;
 RETURN result;
END $f$;

COMMIT;
