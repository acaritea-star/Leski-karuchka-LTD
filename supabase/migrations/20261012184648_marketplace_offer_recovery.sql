-- Preserve original ACLs, tariffs, ledger and request history.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION private.accounting_report_v2(p_from date, p_until date, p_company_id uuid, p_driver_id uuid, p_page integer, p_export boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
  LEFT JOIN public.taxi_requests request ON request.id=o.request_id
  WHERE o.company_id=cid AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND (o.driver_id IS NOT NULL OR request.fare_breakdown->'marketplace' IS NULL)
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
  SELECT count(*) AS total,count(*) FILTER(WHERE private.fleet_online(d.is_online,p.is_active,l.updated_at,l.position_at,current_timestamp)) AS online
  FROM public.drivers d LEFT JOIN public.profiles p ON p.id=d.user_id
   LEFT JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=p_company_id
  WHERE d.company_id=p_company_id
 ), request_totals AS (
  SELECT count(*) FILTER(WHERE status IN ('accepted','arrived','in_progress')
    OR status='pending' AND coalesce(expires_at,created_at+interval '2 minutes')>current_timestamp) AS active,
   count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='cancelled') AS cancelled,
   coalesce(sum(coalesce(final_price,estimated_price,0)) FILTER(WHERE status='completed'),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id
   AND (driver_id IS NOT NULL OR fare_breakdown->'marketplace' IS NULL)
 ), dates AS (
  SELECT anchor-6+n AS day FROM generate_series(0,6) AS s(n)
 ), daily AS (
  SELECT (completed_at AT TIME ZONE 'Europe/Sofia')::date AS day,count(*) AS orders,
   coalesce(sum(coalesce(final_price,estimated_price,0)),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id AND status='completed'
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

CREATE OR REPLACE FUNCTION public.driver_incoming_requests(p_limit integer DEFAULT 50)
 RETURNS SETOF taxi_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests; own public.drivers; offer jsonb;
BEGIN
 SELECT * INTO own FROM public.drivers WHERE user_id=auth.uid() AND public.is_driver(id);
 IF NOT FOUND OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Active driver required' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT request.* FROM public.taxi_requests request WHERE request.status='pending'
  AND clock_timestamp()<coalesce(expires_at,created_at+interval '2 minutes')
  AND private.can_receive_offer(company_id,vehicle_type_id,pickup_latitude,pickup_longitude,fare_breakdown)
  AND NOT EXISTS(SELECT 1 FROM public.request_declines refusal WHERE refusal.request_id=request.id AND refusal.driver_id=own.id)
  ORDER BY created_at DESC LIMIT p_limit LOOP
  IF r.fare_breakdown->'marketplace' IS NOT NULL THEN
   SELECT o.value INTO offer FROM jsonb_array_elements(r.fare_breakdown->'marketplace'->'offers') o
    JOIN public.vehicles v ON v.id=own.vehicle_id
    WHERE o.value->>'company_id'=own.company_id::text AND o.value->>'vehicle_type_id'=v.vehicle_type_id::text;
   r.estimated_price:=(offer->>'total')::numeric;
   r.fare_breakdown:=offer->'breakdown'||jsonb_build_object('marketplace',(r.fare_breakdown->'marketplace')-'offers');
  END IF;
  RETURN NEXT r;
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d.user_id FROM public.taxi_requests r
 CROSS JOIN LATERAL private.eligible_offer_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude,r.fare_breakdown) d
 WHERE r.id=p_request_id AND r.status='pending' AND clock_timestamp()<coalesce(r.expires_at,r.created_at+interval '2 minutes')
 AND NOT EXISTS(SELECT 1 FROM public.request_declines refusal WHERE refusal.request_id=r.id AND refusal.driver_id=d.driver_id);
$function$;
NOTIFY pgrst,'reload schema';
COMMIT;
