-- Keep test payments visible without adding them to the real ledger or turnover.
-- Refunded tests are explicitly excluded, not treated as known net receipts.
-- Keep SECURITY INVOKER, tenant/MFA RLS, the old fields and existing grants.
CREATE OR REPLACE FUNCTION public.driver_day_summary(p_driver_id uuid, p_day date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_driver_id IS NULL OR (SELECT auth.uid()) IS NULL OR NOT (
  (SELECT public.is_driver(p_driver_id)) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id
    AND ((SELECT public.is_company_admin(d.company_id)) OR (SELECT public.is_super_admin())))) THEN
  RAISE EXCEPTION 'Driver summary scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH day_rides AS MATERIALIZED (
  SELECT id,company_id,coalesce(final_price,estimated_price,0) AS fare,final_price,
   payment_environment,payment_method,payment_status,online_payment_state FROM public.taxi_requests
  WHERE driver_id=p_driver_id AND status='completed'
   AND completed_at>=(anchor::timestamp AT TIME ZONE 'Europe/Sofia')
   AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia')
 ), rides AS MATERIALIZED (
  SELECT * FROM day_rides WHERE payment_environment='live'
 ), test_payments AS (
  SELECT coalesce(sum(final_price) FILTER(WHERE payment_status='paid' AND online_payment_state='paid' AND final_price>0),0) total,
   count(*) FILTER(WHERE payment_status='paid' AND online_payment_state='paid' AND final_price>0) count,
   count(*) FILTER(WHERE payment_status='refunded') refunded_count
  FROM day_rides WHERE payment_environment='test' AND payment_method='online'
 ), manual AS (
  SELECT coalesce(sum(e.amount) FILTER(WHERE e.payment_method='cash'),0) cash,
   coalesce(sum(e.amount) FILTER(WHERE e.payment_method='card'),0) card
  FROM public.driver_money_entries e JOIN rides r ON r.id=e.request_id AND r.company_id=e.company_id
  WHERE e.driver_id=p_driver_id AND e.kind='income' AND e.currency='EUR'
   AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')
 ), online AS (
  SELECT coalesce(sum(CASE WHEN p.provider='stripe_refund' THEN -p.amount ELSE p.amount END),0) amount
  FROM public.payment_transactions p JOIN rides r ON r.id=p.request_id AND r.company_id=p.company_id
  WHERE p.method='online' AND ((p.provider='stripe' AND p.status='completed') OR (p.provider='stripe_refund' AND p.status='refunded'))
 )
 SELECT jsonb_build_object('day',anchor,'trips',(SELECT count(*) FROM rides),'earnings',(SELECT coalesce(sum(fare),0) FROM rides),
  'test_payments',jsonb_build_object('total',t.total,'count',t.count,'refunded_count',t.refunded_count),
  'received',jsonb_build_object('cash',m.cash,'card',m.card,'online',greatest(0,o.amount),'total',m.cash+m.card+greatest(0,o.amount)))
 INTO result FROM manual m CROSS JOIN online o CROSS JOIN test_payments t;
 RETURN result;
END;
$function$;
