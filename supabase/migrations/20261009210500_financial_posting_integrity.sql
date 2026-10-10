-- Event-dated financial postings. No historical amounts or rows are rewritten.
-- Supabase CLI unavailable in this workspace; created as a reviewed migration
-- for the pinned disposable Supabase CI and the authorized MCP deployment.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION private.record_driver_money_core(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; original public.driver_money_entries; existing public.driver_money_entries; uid uuid:=auth.uid(); cid uuid; did uuid; owner_id uuid; amt numeric;
BEGIN
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
   IF EXISTS(SELECT 1 FROM public.driver_money_entries e WHERE e.request_id=p_request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')) THEN RAISE EXCEPTION 'Income already recorded for this ride'; END IF;
  END IF;
 END IF;
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,note,request_id,reference_id,recorded_at) VALUES(p_id,cid,did,owner_id,uid,p_kind,amt,btrim(p_note),p_request_id,p_reference_id,clock_timestamp());
 RETURN p_id;
END; $function$;
CREATE OR REPLACE FUNCTION private.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'declaration'::text, p_evidence_ref text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result uuid; previous public.driver_money_entries; ref text:=nullif(btrim(p_evidence_ref),'');
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Account changed' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_source IS NULL OR p_source NOT IN ('declaration','cash_count','cash_book','receipt','bank_record') OR length(ref)>160 THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 IF p_kind='confirmation' OR (p_kind='reversal' AND EXISTS(
  SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=p_reference_id AND c.kind='confirmation'
 )) THEN
  IF p_source='declaration' OR (p_source<>'cash_count' AND ref IS NULL) THEN RAISE EXCEPTION 'Confirmation needs a source and reference'; END IF;
 ELSIF p_source<>'declaration' OR ref IS NOT NULL THEN RAISE EXCEPTION 'Only a company confirmation or correction can verify evidence'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND AND (previous.evidence_source IS DISTINCT FROM p_source OR previous.evidence_reference IS DISTINCT FROM ref) THEN RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505'; END IF;
 result:=private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
 IF previous.id IS NULL THEN UPDATE public.driver_money_entries SET evidence_source=p_source,evidence_reference=ref WHERE id=result; END IF;
 RETURN result;
END $function$;
CREATE OR REPLACE FUNCTION private.record_driver_money(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
 IF p_kind='confirmation' OR (p_kind='reversal' AND EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=p_reference_id AND kind='confirmation')) THEN
  RAISE EXCEPTION 'Use the verified confirmation API with an evidence source' USING ERRCODE='42501';
 END IF;
 RETURN private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
END $function$;

-- STABLE keeps the complete report/export on one statement snapshot. INVOKER
-- preserves table RLS; the scope checks also reject inactive/foreign accounts.
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
   EXISTS(SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=e.id AND c.kind='confirmation') company_confirmed,
   e.amount-o.booked_amount difference
  FROM shown_outcomes o LEFT JOIN LATERAL (
   SELECT m.* FROM public.driver_money_entries m WHERE m.request_id=o.request_id AND m.kind='income'
    AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')
   ORDER BY m.recorded_at DESC,m.id LIMIT 1
  ) e ON true WHERE o.outcome='completed'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts,
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
  'totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),'balance',(SELECT to_jsonb(b) FROM balances b),
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

CREATE OR REPLACE FUNCTION public.accounting_report(p_from date,p_until date,p_company_id uuid DEFAULT NULL,p_driver_id uuid DEFAULT NULL,p_page integer DEFAULT 0)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
 SELECT private.accounting_report_v2(p_from,p_until,p_company_id,p_driver_id,p_page,false);
$function$;
CREATE OR REPLACE FUNCTION public.accounting_export(p_from date,p_until date,p_company_id uuid DEFAULT NULL,p_driver_id uuid DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $function$
 SELECT private.accounting_report_v2(p_from,p_until,p_company_id,p_driver_id,0,true);
$function$;
REVOKE ALL ON FUNCTION private.accounting_report_v2(date,date,uuid,uuid,integer,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.accounting_report_v2(date,date,uuid,uuid,integer,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.accounting_export(date,date,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.accounting_export(date,date,uuid,uuid) TO authenticated;
-- Existing write entry points retain their explicit grants. The privileged
-- core stays inaccessible to clients; proof requirements cannot be bypassed.
REVOKE ALL ON FUNCTION private.record_driver_money_core(uuid,text,numeric,text,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
