-- Atomic ride checkout, explicit tender and private expense evidence.
-- Historical declarations retain their original amounts and unknown tender.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Enable only after the matching frontend is published, so old clients can finish safely.
ALTER TABLE private.app_security ADD COLUMN ride_payment_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.driver_money_entries ADD COLUMN payment_method text CHECK(payment_method IN ('cash','card'));
CREATE INDEX money_request_income_idx ON public.driver_money_entries(request_id) WHERE request_id IS NOT NULL AND kind='income';
CREATE TABLE public.ride_payment_receipts(
 request_id uuid PRIMARY KEY REFERENCES public.taxi_requests(id) ON DELETE CASCADE,
 id uuid NOT NULL UNIQUE,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES public.drivers(id),
 driver_user_id uuid NOT NULL REFERENCES public.profiles(id),
 expected_amount numeric(12,2) NOT NULL CHECK(expected_amount>=0 AND expected_amount<=1000000),
 received_amount numeric(12,2) NOT NULL CHECK(received_amount>=0 AND received_amount<=expected_amount),
 choice text NOT NULL CHECK(choice IN ('cash','card','unpaid','partial_cash','partial_card')),
 payment_method text CHECK(payment_method IN ('cash','card')),
 partial_amount numeric(12,2),note text NOT NULL CHECK(length(note)<=500),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 entry_id uuid REFERENCES public.driver_money_entries(id),
 CHECK((choice IN ('cash','card') AND received_amount=expected_amount AND payment_method=choice AND partial_amount IS NULL)
  OR (choice='unpaid' AND received_amount=0 AND payment_method IS NULL AND partial_amount IS NULL AND length(btrim(note))>0)
  OR (choice IN ('partial_cash','partial_card') AND received_amount>0 AND received_amount<expected_amount AND partial_amount=received_amount AND payment_method=substr(choice,9) AND length(btrim(note))>0))
);
CREATE INDEX ride_payment_company_idx ON public.ride_payment_receipts(company_id,recorded_at DESC);
CREATE INDEX ride_payment_driver_idx ON public.ride_payment_receipts(driver_id);
CREATE INDEX ride_payment_user_idx ON public.ride_payment_receipts(driver_user_id);
CREATE INDEX ride_payment_entry_idx ON public.ride_payment_receipts(entry_id) WHERE entry_id IS NOT NULL;
ALTER TABLE public.ride_payment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_payment_receipts FROM anon,authenticated;
GRANT SELECT ON public.ride_payment_receipts TO authenticated;
CREATE POLICY ride_payment_read ON public.ride_payment_receipts FOR SELECT TO authenticated USING(
 public.is_driver(driver_id) OR public.is_company_admin(company_id) OR public.is_super_admin());
CREATE POLICY staff_mfa_required ON public.ride_payment_receipts AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT private.staff_mfa_allowed())) WITH CHECK((SELECT private.staff_mfa_allowed()));
CREATE OR REPLACE FUNCTION private.record_driver_money_core(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; original public.driver_money_entries; existing public.driver_money_entries; uid uuid:=auth.uid(); cid uuid; did uuid; owner_id uuid; amt numeric;
BEGIN
 IF NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'MFA_REQUIRED' USING ERRCODE='42501'; END IF;
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('income','expense','handover','confirmation','reversal') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid entry'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO existing FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND THEN
  IF existing.actor_id=uid AND existing.kind=p_kind AND existing.note=btrim(p_note) AND existing.request_id IS NOT DISTINCT FROM p_request_id AND existing.reference_id IS NOT DISTINCT FROM p_reference_id
   AND (p_kind IN ('confirmation','reversal') OR existing.amount=p_amount) THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505';
 END IF;
 IF p_kind IN ('confirmation','reversal') THEN
  SELECT * INTO original FROM public.driver_money_entries WHERE id=p_reference_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='reversal') THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF p_kind='confirmation' THEN
   IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='confirmation') THEN RAISE EXCEPTION 'Entry already confirmed'; END IF;
   IF original.kind NOT IN ('handover','income') OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Only a different company administrator can confirm receipt' USING ERRCODE='42501'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='confirmation') THEN
    IF original.kind NOT IN ('income','handover') OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN
     RAISE EXCEPTION 'Confirmed entry requires a company correction' USING ERRCODE='42501';
    END IF;
   ELSIF original.actor_id IS DISTINCT FROM uid OR original.kind NOT IN ('income','expense','handover') OR NOT public.is_driver(original.driver_id) THEN
    RAISE EXCEPTION 'Only your own unconfirmed entry can be reversed' USING ERRCODE='42501';
   END IF;
  END IF;
  cid:=original.company_id;did:=original.driver_id;owner_id:=original.driver_user_id;amt:=original.amount;
  IF p_request_id IS NOT NULL THEN RAISE EXCEPTION 'Reference operation cannot set a request'; END IF;
 ELSE
  IF p_reference_id IS NOT NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Invalid amount or reference'; END IF;
  SELECT * INTO d FROM public.drivers WHERE user_id=uid;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Driver account required' USING ERRCODE='42501'; END IF;
  cid:=d.company_id;did:=d.id;owner_id:=uid;amt:=p_amount;
  IF p_request_id IS NOT NULL AND (p_kind<>'income' OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=p_request_id AND driver_id=d.id AND company_id=d.company_id AND status='completed')) THEN RAISE EXCEPTION 'Income can only link to your completed ride' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NOT NULL THEN
   PERFORM 1 FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=p_request_id) THEN
    IF p_amount+coalesce((SELECT sum(e.amount) FROM public.driver_money_entries e WHERE e.request_id=p_request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')),0)>(SELECT expected_amount FROM public.ride_payment_receipts WHERE request_id=p_request_id) THEN
     RAISE EXCEPTION 'Income already recorded or exceeds remaining fare';
    END IF;
   ELSIF EXISTS(SELECT 1 FROM public.driver_money_entries e WHERE e.request_id=p_request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')) THEN RAISE EXCEPTION 'Income already recorded for this ride'; END IF;
  END IF;
 END IF;
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,note,request_id,reference_id,recorded_at) VALUES(p_id,cid,did,owner_id,uid,p_kind,amt,btrim(p_note),p_request_id,p_reference_id,clock_timestamp());
 RETURN p_id;
END; $function$;

-- Explicit tender is immutable for an existing operation; corrections inherit it.
CREATE FUNCTION private.record_driver_money_method(p_id uuid,p_kind text,p_amount numeric,p_note text,p_actor uuid,p_payment_method text,
 p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL,p_source text DEFAULT 'declaration',p_evidence_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE previous public.driver_money_entries; result uuid; method text:=p_payment_method;
BEGIN
 IF NOT private.staff_mfa_allowed() OR auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_kind IN ('confirmation','reversal') THEN
  SELECT payment_method INTO method FROM public.driver_money_entries WHERE id=p_reference_id;
 ELSIF method IS NULL OR method NOT IN ('cash','card') OR (p_kind='handover' AND method<>'cash') THEN RAISE EXCEPTION 'Choose cash or card'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND AND previous.payment_method IS DISTINCT FROM method THEN RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505'; END IF;
 result:=private.record_driver_money_verified(p_id,p_kind,p_amount,p_note,p_actor,p_request_id,p_reference_id,p_source,p_evidence_ref);
 IF previous.id IS NULL THEN UPDATE public.driver_money_entries SET payment_method=method WHERE id=result; END IF;
 RETURN result;
END $fn$;
CREATE FUNCTION public.record_driver_money_method(p_id uuid,p_kind text,p_amount numeric,p_note text,p_actor uuid,p_payment_method text,
 p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL,p_source text DEFAULT 'declaration',p_evidence_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.record_driver_money_method(p_id,p_kind,p_amount,p_note,p_actor,p_payment_method,p_request_id,p_reference_id,p_source,p_evidence_ref);
$fn$;
CREATE FUNCTION private.complete_ride_payment(p_id uuid,p_request_id uuid,p_actor uuid,p_choice text,p_partial_amount numeric DEFAULT NULL,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d public.drivers; ride public.taxi_requests; receipt public.ride_payment_receipts; amount numeric; method text; stamp timestamptz; entry uuid; note text:=btrim(p_note);
BEGIN
 IF auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.drivers WHERE user_id=p_actor;
 IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Driver account required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_choice IS NULL OR p_choice NOT IN ('cash','card','unpaid','partial_cash','partial_card') OR note IS NULL OR length(note)>500 THEN RAISE EXCEPTION 'Invalid payment choice'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO receipt FROM public.ride_payment_receipts WHERE id=p_id;
 IF FOUND AND (receipt.request_id IS DISTINCT FROM p_request_id OR receipt.driver_user_id IS DISTINCT FROM p_actor OR receipt.choice IS DISTINCT FROM p_choice OR receipt.partial_amount IS DISTINCT FROM p_partial_amount OR receipt.note IS DISTINCT FROM note) THEN
  RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505';
 END IF;
 SELECT * INTO ride FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND OR ride.driver_id IS DISTINCT FROM d.id OR ride.company_id IS DISTINCT FROM d.company_id THEN RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501'; END IF;
 IF receipt.id IS NOT NULL THEN
  IF ride.status<>'completed' THEN RAISE EXCEPTION 'Payment and ride inconsistent'; END IF;
  RETURN jsonb_build_object('receipt',to_jsonb(receipt),'ride',to_jsonb(ride));
 END IF;
 IF ride.status<>'in_progress' OR EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=ride.id) THEN RAISE EXCEPTION 'Ride already completed or no longer in progress'; END IF;
 IF ride.estimated_price IS NULL OR ride.estimated_price<=0 OR ride.estimated_price>1000000 OR ride.estimated_price<>round(ride.estimated_price,2) THEN RAISE EXCEPTION 'Ride has no valid agreed fare'; END IF;
 IF p_choice IN ('cash','card') THEN
  IF p_partial_amount IS NOT NULL THEN RAISE EXCEPTION 'Full payment uses the agreed fare'; END IF;
  amount:=ride.estimated_price;method:=p_choice;
 ELSIF p_choice='unpaid' THEN
  IF p_partial_amount IS NOT NULL OR note='' THEN RAISE EXCEPTION 'Explain the unpaid fare'; END IF;
  amount:=0;method:=NULL;
 ELSE
  IF p_partial_amount IS NULL OR p_partial_amount<=0 OR p_partial_amount>=ride.estimated_price OR p_partial_amount<>round(p_partial_amount,2) OR note='' THEN RAISE EXCEPTION 'Invalid partial payment'; END IF;
  amount:=p_partial_amount;method:=substr(p_choice,9);
 END IF;
 stamp:=clock_timestamp();
 INSERT INTO public.ride_payment_receipts(request_id,id,company_id,driver_id,driver_user_id,expected_amount,received_amount,choice,payment_method,partial_amount,note,recorded_at)
 VALUES(ride.id,p_id,d.company_id,d.id,p_actor,ride.estimated_price,amount,p_choice,method,p_partial_amount,note,stamp);
 UPDATE public.taxi_requests SET status='completed',completed_at=stamp,final_price=ride.estimated_price,
  payment_method=coalesce(method::public.payment_method,ride.payment_method),updated_at=stamp WHERE id=ride.id RETURNING * INTO ride;
 IF amount>0 THEN
  entry:=private.record_driver_money_method(p_id,'income',amount,'Плащане по курс '||left(ride.id::text,8),p_actor,method,ride.id);
  UPDATE public.driver_money_entries SET recorded_at=stamp WHERE id=entry;
  UPDATE public.ride_payment_receipts SET entry_id=entry WHERE id=p_id;
 END IF;
 SELECT * INTO receipt FROM public.ride_payment_receipts WHERE id=p_id;
 RETURN jsonb_build_object('receipt',to_jsonb(receipt),'ride',to_jsonb(ride));
END $fn$;
CREATE FUNCTION public.complete_ride_payment(p_id uuid,p_request_id uuid,p_actor uuid,p_choice text,p_partial_amount numeric DEFAULT NULL,p_note text DEFAULT '')
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.complete_ride_payment(p_id,p_request_id,p_actor,p_choice,p_partial_amount,p_note);
$fn$;
CREATE FUNCTION private.ride_payment_gate_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT ride_payment_required FROM private.app_security WHERE singleton;
$fn$;
REVOKE ALL ON FUNCTION private.ride_payment_gate_enabled() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.ride_payment_gate_enabled() TO authenticated;
CREATE FUNCTION private.require_ride_payment() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF NEW.status='completed' AND OLD.status IS DISTINCT FROM NEW.status AND private.ride_payment_gate_enabled() THEN
  RAISE EXCEPTION 'PAYMENT_REQUIRED: use the ride payment confirmation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER require_ride_payment BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.require_ride_payment();
REVOKE ALL ON FUNCTION private.require_ride_payment() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.accounting_report_v2(
 p_from date,p_until date,p_company_id uuid,p_driver_id uuid,p_page integer,p_export boolean
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE result jsonb; cid uuid:=p_company_id; take integer:=CASE WHEN p_export THEN 10000 ELSE 25 END;
 start_at timestamptz:=p_from::timestamp AT TIME ZONE 'Europe/Sofia';
 end_at timestamptz:=p_until::timestamp AT TIME ZONE 'Europe/Sofia';
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN
  RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
 END IF;
 IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until) OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 OR p_export IS NULL THEN
  RAISE EXCEPTION 'Invalid report period';
 END IF;
 IF p_driver_id IS NOT NULL THEN
  SELECT d.company_id INTO cid FROM public.drivers d WHERE d.id=p_driver_id
   AND (public.is_driver(d.id) OR public.is_company_admin(d.company_id) OR public.is_super_admin());
  IF NOT FOUND OR (p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM cid) THEN
   RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501';
  END IF;
 ELSIF cid IS NULL OR NOT(public.is_company_admin(cid) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name
  FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id
  WHERE o.company_id=cid AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND o.occurred_at>=start_at AND o.occurred_at<end_at
 ), postings AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,
   original.kind reference_kind,original.recorded_at reference_recorded_at,
   coalesce(original.kind,e.kind) effective_kind,
   coalesce(original.payment_method,e.payment_method) effective_method,
   CASE WHEN e.kind='reversal' THEN -e.amount WHEN e.kind='confirmation' THEN 0 ELSE e.amount END signed_amount,
   CASE WHEN e.kind='confirmation' THEN e.amount WHEN e.kind='reversal' AND EXISTS(
    SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=e.reference_id AND c.kind='confirmation'
   ) THEN -e.amount ELSE 0 END verified_amount
  FROM public.driver_money_entries e
  LEFT JOIN public.driver_money_entries original ON original.id=e.reference_id
  LEFT JOIN public.profiles p ON p.id=e.driver_user_id
  WHERE e.company_id=cid AND (p_driver_id IS NULL OR e.driver_id=p_driver_id) AND e.recorded_at<end_at
 ), movements AS MATERIALIZED (
  SELECT p.*,CASE WHEN effective_kind='income' THEN signed_amount ELSE -signed_amount END balance_delta FROM postings p
 ), period_money AS MATERIALIZED (
  SELECT m.* FROM movements m WHERE recorded_at>=start_at
 ), shown_outcomes AS MATERIALIZED (
  SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT take OFFSET p_page*take
 ), reconciliation AS MATERIALIZED (
  -- Current reconciliation is explicitly separate from historical postings.
  SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
   coalesce(e.company_confirmed,false) company_confirmed,e.amount-o.booked_amount difference,
   e.method payment_method, greatest(0,o.booked_amount-coalesce(e.amount,0)) outstanding,
   receipt.choice checkout_choice,receipt.note payment_note
  FROM shown_outcomes o LEFT JOIN public.ride_payment_receipts receipt ON receipt.request_id=o.request_id
  LEFT JOIN LATERAL (
   SELECT sum(m.amount) amount,max(m.recorded_at) recorded_at,
    bool_and(EXISTS(SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation')) company_confirmed,
    CASE WHEN count(DISTINCT coalesce(m.payment_method,'unknown'))>1 THEN 'mixed' ELSE max(m.payment_method) END method
   FROM public.driver_money_entries m WHERE m.request_id=o.request_id AND m.kind='income'
    AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')
  ) e ON true WHERE o.outcome='completed'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts,
   count(*) FILTER(WHERE outcome='completed' AND (SELECT sum(m.amount) FROM public.driver_money_entries m WHERE m.request_id=outcomes.request_id AND m.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')) BETWEEN 0.01 AND booked_amount-0.01) partially_paid,
   count(*) FILTER(WHERE outcome='completed' AND NOT EXISTS(
    SELECT 1 FROM public.driver_money_entries m WHERE m.request_id=outcomes.request_id AND m.kind='income'
     AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')
   )) unreported_completed FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(signed_amount) FILTER(WHERE effective_kind='income'),0) income,
   coalesce(sum(signed_amount) FILTER(WHERE effective_kind='expense'),0) expenses,
   coalesce(sum(signed_amount) FILTER(WHERE effective_kind='handover'),0) handed_over,
   coalesce(sum(verified_amount) FILTER(WHERE effective_kind='handover'),0) confirmed_handover,
   coalesce(sum(verified_amount) FILTER(WHERE effective_kind='income'),0) confirmed_income,
   coalesce(sum(CASE WHEN effective_kind='income' THEN signed_amount WHEN effective_kind='expense' THEN -signed_amount ELSE 0 END),0) net_income
  FROM period_money
 ), balances AS (
  SELECT coalesce(sum(balance_delta) FILTER(WHERE recorded_at<start_at),0) opening,
   coalesce(sum(balance_delta) FILTER(WHERE recorded_at>=start_at),0) movement,
   coalesce(sum(balance_delta),0) closing,
   coalesce(sum(signed_amount-verified_amount) FILTER(WHERE effective_kind='handover'),0) unconfirmed_handover,
   coalesce(sum(signed_amount-verified_amount) FILTER(WHERE effective_kind='income'),0) unconfirmed_income
  FROM movements
 ), payment_breakdown AS (
  SELECT
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='cash'),0) cash_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='card'),0) card_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method IS NULL),0) unknown_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method='cash'),0) cash_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method='card'),0) card_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method IS NULL),0) unknown_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover' AND effective_method='cash'),0) cash_handover,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover' AND effective_method IS NULL),0) unknown_handover,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash' AND recorded_at<start_at),0) cash_opening,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash' AND recorded_at>=start_at),0) cash_movement,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash'),0) cash_closing,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method IS NULL),0) unknown_closing
  FROM movements
 ), driver_trips AS (
  SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,
   count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked
  FROM outcomes GROUP BY driver_id
 ), driver_money AS (
  SELECT driver_id,max(driver_name) driver_name,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income'),0) income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense'),0) expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover'),0) handed_over,
   coalesce(sum(verified_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income'),0) confirmed_income,
   coalesce(sum(verified_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover'),0) confirmed_handover,
   coalesce(sum(balance_delta),0) closing
  FROM movements GROUP BY driver_id
 ), driver_ids AS (
  SELECT driver_id FROM driver_trips UNION SELECT driver_id FROM driver_money
 ), drivers AS (
  SELECT ids.driver_id,coalesce(t.driver_name,m.driver_name,'') driver_name,
   coalesce(t.trips,0) trips,coalesce(t.cancelled,0) cancelled,coalesce(t.booked,0) booked,
   coalesce(m.income,0) income,coalesce(m.expenses,0) expenses,coalesce(m.handed_over,0) handed_over,
   coalesce(m.confirmed_income,0) confirmed_income,coalesce(m.confirmed_handover,0) confirmed_handover,coalesce(m.closing,0) closing
  FROM driver_ids ids LEFT JOIN driver_trips t ON t.driver_id IS NOT DISTINCT FROM ids.driver_id
   LEFT JOIN driver_money m ON m.driver_id IS NOT DISTINCT FROM ids.driver_id
 ) SELECT jsonb_build_object(
  'report_version',2,'period',jsonb_build_object('from',p_from,'until',p_until,'timezone','Europe/Sofia'),
  'scope',jsonb_build_object('company_id',cid,'driver_id',p_driver_id),'currency','EUR','generated_at',statement_timestamp(),
  'payment_breakdown',(SELECT to_jsonb(pb) FROM payment_breakdown pb),'totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),'balance',(SELECT to_jsonb(b) FROM balances b),
  'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM period_money),'driver_count',(SELECT count(*) FROM drivers),
  'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM reconciliation r),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY occurred_at DESC,id) FROM (
   SELECT o.*,(SELECT to_jsonb(e) FROM public.ride_evidence e WHERE e.request_id=o.request_id) evidence FROM shown_outcomes o
  ) x),'[]'::jsonb),
  'entries',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY recorded_at DESC,id) FROM (
   SELECT m.*,
    EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal') reversed,
    EXISTS(SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation') confirmed,
    (SELECT r.recorded_at FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal') reversed_at,
    (SELECT c.recorded_at FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation') confirmed_at
   FROM period_money m ORDER BY recorded_at DESC,id LIMIT take OFFSET p_page*take
  ) x),'[]'::jsonb),
  'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY booked DESC,driver_id) FROM (
   SELECT * FROM drivers ORDER BY booked DESC,driver_id LIMIT CASE WHEN p_export THEN 10000 ELSE 50 END
  ) x),'[]'::jsonb)
 ) INTO result;
 IF p_export AND (greatest((result->>'outcome_count')::bigint,(result->>'entry_count')::bigint,(result->>'driver_count')::bigint)>10000) THEN
  RAISE EXCEPTION 'Export limit exceeded: narrow the period to at most 10000 records per collection' USING ERRCODE='54000';
 END IF;
 RETURN result;
END $function$;


-- Evidence is attached to an already-posted expense, never another money write.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('expense-receipts','expense-receipts',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf']);
CREATE TABLE public.expense_receipts(
 id uuid PRIMARY KEY,entry_id uuid NOT NULL REFERENCES public.driver_money_entries(id),
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 driver_id uuid NOT NULL REFERENCES public.drivers(id),driver_user_id uuid NOT NULL REFERENCES public.profiles(id),
 slot smallint NOT NULL CHECK(slot BETWEEN 1 AND 3),file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 160),
 mime_type text NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
 byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),
 path text NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),uploaded_at timestamptz,
 UNIQUE(entry_id,slot)
);
CREATE INDEX expense_receipts_company_idx ON public.expense_receipts(company_id);
CREATE INDEX expense_receipts_driver_idx ON public.expense_receipts(driver_id);
CREATE INDEX expense_receipts_user_idx ON public.expense_receipts(driver_user_id);
ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.expense_receipts FROM anon,authenticated;
GRANT SELECT ON public.expense_receipts TO authenticated;
CREATE POLICY expense_receipts_read ON public.expense_receipts FOR SELECT TO authenticated USING(
 (driver_user_id=(SELECT auth.uid()) AND public.is_driver(driver_id)) OR
 (uploaded_at IS NOT NULL AND (public.is_company_admin(company_id) OR public.is_super_admin())));
CREATE POLICY staff_mfa_required ON public.expense_receipts AS RESTRICTIVE FOR ALL TO authenticated
 USING((SELECT private.staff_mfa_allowed())) WITH CHECK((SELECT private.staff_mfa_allowed()));
CREATE FUNCTION private.reserve_expense_receipt(p_id uuid,p_entry_id uuid,p_actor uuid,p_file_name text,p_mime_type text,p_byte_size integer,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE e public.driver_money_entries; previous public.expense_receipts; slot_number integer; suffix text; path text;
BEGIN
 IF auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_file_name IS NULL OR length(p_file_name) NOT BETWEEN 1 AND 160 OR p_mime_type IS NULL OR p_mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf') OR p_byte_size IS NULL OR p_byte_size NOT BETWEEN 1 AND 5242880 OR p_digest IS NULL OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Choose JPG, PNG, WebP or PDF up to 5 MB'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO e FROM public.driver_money_entries WHERE id=p_entry_id FOR UPDATE;
 IF NOT FOUND OR e.kind<>'expense' OR e.driver_user_id IS DISTINCT FROM p_actor OR NOT public.is_driver(e.driver_id) THEN RAISE EXCEPTION 'Expense not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO previous FROM public.expense_receipts WHERE id=p_id;
 IF FOUND THEN
  IF previous.entry_id=p_entry_id AND previous.file_name=p_file_name AND previous.mime_type=p_mime_type AND previous.byte_size=p_byte_size AND previous.digest=p_digest THEN RETURN to_jsonb(previous); END IF;
  RAISE EXCEPTION 'Upload ID already used' USING ERRCODE='23505';
 END IF;
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=e.id AND kind='reversal') THEN RAISE EXCEPTION 'Expense already reversed'; END IF;
 SELECT n INTO slot_number FROM generate_series(1,3) n WHERE NOT EXISTS(SELECT 1 FROM public.expense_receipts r WHERE r.entry_id=e.id AND r.slot=n) ORDER BY n LIMIT 1;
 IF slot_number IS NULL THEN RAISE EXCEPTION 'At most three files per expense'; END IF;
 suffix:=CASE p_mime_type WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' ELSE 'pdf' END;
 path:=e.company_id::text||'/'||e.driver_id::text||'/'||e.id::text||'/'||p_id::text||'.'||suffix;
 INSERT INTO public.expense_receipts(id,entry_id,company_id,driver_id,driver_user_id,slot,file_name,mime_type,byte_size,digest,path)
 VALUES(p_id,e.id,e.company_id,e.driver_id,p_actor,slot_number,p_file_name,p_mime_type,p_byte_size,p_digest,path) RETURNING * INTO previous;
 RETURN to_jsonb(previous);
END $fn$;
CREATE FUNCTION public.reserve_expense_receipt(p_id uuid,p_entry_id uuid,p_actor uuid,p_file_name text,p_mime_type text,p_byte_size integer,p_digest text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.reserve_expense_receipt(p_id,p_entry_id,p_actor,p_file_name,p_mime_type,p_byte_size,p_digest);
$fn$;
CREATE FUNCTION private.finalize_expense_receipt(p_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.expense_receipts;
BEGIN
 IF auth.uid() IS NULL OR p_actor IS DISTINCT FROM auth.uid() OR NOT private.staff_mfa_allowed() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.expense_receipts WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR r.driver_user_id IS DISTINCT FROM p_actor OR NOT public.is_driver(r.driver_id) THEN RAISE EXCEPTION 'Receipt not allowed' USING ERRCODE='42501'; END IF;
 IF r.uploaded_at IS NULL THEN
  IF NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='expense-receipts' AND o.name=r.path
    AND o.metadata->>'mimetype'=r.mime_type AND (o.metadata->>'size')::bigint=r.byte_size) THEN RAISE EXCEPTION 'Receipt upload not confirmed'; END IF;
  UPDATE public.expense_receipts SET uploaded_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
 END IF;
 RETURN to_jsonb(r);
END $fn$;
CREATE FUNCTION public.finalize_expense_receipt(p_id uuid,p_actor uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.finalize_expense_receipt(p_id,p_actor);
$fn$;
CREATE POLICY expense_receipt_file_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(
 bucket_id='expense-receipts' AND EXISTS(SELECT 1 FROM public.expense_receipts r WHERE r.path=name AND r.uploaded_at IS NULL AND r.driver_user_id=(SELECT auth.uid()) AND public.is_driver(r.driver_id)));
CREATE POLICY expense_receipt_file_read ON storage.objects FOR SELECT TO authenticated USING(
 bucket_id='expense-receipts' AND EXISTS(SELECT 1 FROM public.expense_receipts r WHERE r.path=name AND r.uploaded_at IS NOT NULL));
-- No update, overwrite, or delete policies: original evidence remains immutable.
REVOKE ALL ON FUNCTION private.record_driver_money_core(uuid,text,numeric,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.record_driver_money_method(uuid,text,numeric,text,uuid,text,uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.record_driver_money_method(uuid,text,numeric,text,uuid,text,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION private.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION private.reserve_expense_receipt(uuid,uuid,uuid,text,text,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.reserve_expense_receipt(uuid,uuid,uuid,text,text,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION private.finalize_expense_receipt(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.finalize_expense_receipt(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.record_driver_money_method(uuid,text,numeric,text,uuid,text,uuid,uuid,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.record_driver_money_method(uuid,text,numeric,text,uuid,text,uuid,uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.complete_ride_payment(uuid,uuid,uuid,text,numeric,text) TO authenticated;
REVOKE ALL ON FUNCTION public.reserve_expense_receipt(uuid,uuid,uuid,text,text,integer,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.reserve_expense_receipt(uuid,uuid,uuid,text,text,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.finalize_expense_receipt(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_expense_receipt(uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
