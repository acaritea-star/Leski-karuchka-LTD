SET LOCAL lock_timeout='2s';

CREATE FUNCTION public.company_dashboard(p_company_id uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_company_id IS NULL OR (SELECT auth.uid()) IS NULL
  OR NOT ((SELECT public.is_company_admin(p_company_id)) OR (SELECT public.is_super_admin())) THEN
  RAISE EXCEPTION 'Dashboard scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH driver_totals AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE is_online) AS online
  FROM public.drivers WHERE company_id=p_company_id
 ), request_totals AS (
  SELECT count(*) FILTER(WHERE status IN ('accepted','arrived','in_progress')
    OR status='pending' AND coalesce(expires_at,created_at+interval '2 minutes')>current_timestamp) AS active,
   count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='cancelled') AS cancelled,
   coalesce(sum(coalesce(final_price,estimated_price,0)) FILTER(WHERE status='completed'),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id
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
REVOKE ALL ON FUNCTION public.company_dashboard(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.company_dashboard(uuid,date) TO authenticated;

CREATE FUNCTION public.driver_day_summary(p_driver_id uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_driver_id IS NULL OR (SELECT auth.uid()) IS NULL OR NOT (
  (SELECT public.is_driver(p_driver_id)) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id
    AND ((SELECT public.is_company_admin(d.company_id)) OR (SELECT public.is_super_admin())))) THEN
  RAISE EXCEPTION 'Driver summary scope not allowed' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object('day',anchor,'trips',count(*),'earnings',coalesce(sum(coalesce(final_price,estimated_price,0)),0))
 INTO result FROM public.taxi_requests WHERE driver_id=p_driver_id AND status='completed'
  AND completed_at>=(anchor::timestamp AT TIME ZONE 'Europe/Sofia')
  AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia');
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.driver_day_summary(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.driver_day_summary(uuid,date) TO authenticated;
CREATE INDEX IF NOT EXISTS requests_company_completed_idx ON public.taxi_requests(company_id,completed_at)
 WHERE status='completed';
