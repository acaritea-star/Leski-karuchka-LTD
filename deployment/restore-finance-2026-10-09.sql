-- Restores function behavior only; never deletes financial history.
BEGIN;
SET LOCAL lock_timeout='5s';
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
   IF original.kind NOT IN ('handover','income') OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Only a different company administrator can confirm receipt' USING ERRCODE='42501'; END IF;
  ELSE
   IF original.actor_id IS DISTINCT FROM uid OR original.kind NOT IN ('income','expense','handover') OR NOT public.is_driver(original.driver_id) THEN RAISE EXCEPTION 'Only your own unconfirmed entry can be reversed' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='confirmation') THEN RAISE EXCEPTION 'Confirmed handover cannot be reversed'; END IF;
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
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,note,request_id,reference_id) VALUES(p_id,cid,did,owner_id,uid,p_kind,amt,btrim(p_note),p_request_id,p_reference_id);
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
 IF p_kind='confirmation' THEN
  IF p_source='declaration' OR (p_source<>'cash_count' AND ref IS NULL) THEN RAISE EXCEPTION 'Confirmation needs a source and reference'; END IF;
 ELSIF p_source<>'declaration' OR ref IS NOT NULL THEN RAISE EXCEPTION 'Only a company confirmation can verify evidence'; END IF;
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
 IF p_kind='confirmation' AND EXISTS(SELECT 1 FROM public.driver_money_entries WHERE id=p_reference_id AND kind='income') THEN
  RAISE EXCEPTION 'Use the verified confirmation API with an evidence source' USING ERRCODE='42501';
 END IF;
 RETURN private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
END $function$;
CREATE OR REPLACE FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'Invalid report period'; END IF;
 IF p_driver_id IS NULL AND (p_company_id IS NULL OR NOT(public.is_company_admin(p_company_id) OR public.is_super_admin())) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 IF p_driver_id IS NOT NULL AND NOT(public.is_driver(p_driver_id) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id AND (public.is_company_admin(d.company_id) OR public.is_super_admin()))) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id WHERE (p_company_id IS NULL OR o.company_id=p_company_id) AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND o.occurred_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND o.occurred_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), money AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal') reversed,
   EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='confirmation') confirmed
  FROM public.driver_money_entries e LEFT JOIN public.profiles p ON p.id=e.driver_user_id WHERE (p_company_id IS NULL OR e.company_id=p_company_id) AND (p_driver_id IS NULL OR e.driver_id=p_driver_id)
   AND e.recorded_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND e.recorded_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed),0) income,
   coalesce(sum(amount) FILTER(WHERE kind='expense' AND NOT reversed),0) expenses,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed),0) handed_over,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed AND confirmed),0) confirmed_handover,
   coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed AND confirmed),0) confirmed_income FROM money
 ) SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),
 'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM money),
 'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
 EXISTS(SELECT 1 FROM public.driver_money_entries conf WHERE conf.reference_id=e.id AND conf.kind='confirmation') company_confirmed,
 e.amount-o.booked_amount difference
 FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) o
 LEFT JOIN LATERAL (SELECT e.* FROM public.driver_money_entries e WHERE e.request_id=o.request_id AND e.kind='income'
  AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')
  ORDER BY e.recorded_at DESC,e.id LIMIT 1) e ON true
 WHERE o.outcome='completed')x),'[]'::jsonb),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT o.*, (SELECT to_jsonb(e) FROM public.ride_evidence e WHERE e.request_id=o.request_id) evidence FROM outcomes o ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END; $function$;
DROP FUNCTION IF EXISTS public.accounting_export(date,date,uuid,uuid);
DROP FUNCTION IF EXISTS private.accounting_report_v2(date,date,uuid,uuid,integer,boolean);
COMMIT;
