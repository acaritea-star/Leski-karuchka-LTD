-- Emergency rollback only. Run after reverting the frontend and google-routes.
-- Keeps rides, financial records, GPS observations and accepted-version history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.driver_locations DISABLE TRIGGER observe_active_ride_location;
ALTER TABLE public.taxi_requests DISABLE TRIGGER observe_ride_transition;
UPDATE private.legal_versions SET is_current=false WHERE is_current;
UPDATE private.legal_versions SET is_current=true WHERE terms_version='2026-10-03-draft.2' AND privacy_version='2026-10-04.2';
CREATE OR REPLACE FUNCTION private.accept_legal_versions(p_terms text, p_privacy text, p_method text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT source_digest INTO digest FROM private.legal_versions WHERE is_current AND terms_version=p_terms AND privacy_version=p_privacy;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
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
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END; $function$;
COMMIT;

