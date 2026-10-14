BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION private.accept_request(p_request_id uuid)
 RETURNS public.taxi_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests; d public.drivers; loc public.driver_locations; own_type uuid; allowed_identity boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='DRIVER' AND is_active)
 THEN RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501'; END IF;
 -- All acceptance paths keep the same request -> driver lock order.
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_CLOSED: Заявката вече не е налична. Списъкът се обновява.'; END IF;
 SELECT * INTO d FROM public.drivers WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501'; END IF;
 IF r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress','completed') THEN RETURN r; END IF;
 IF r.status<>'pending' OR clock_timestamp()>=coalesce(r.expires_at,r.created_at+interval '2 minutes')
 THEN RAISE EXCEPTION 'REQUEST_CLOSED: Заявката вече не е налична. Приета е от друг шофьор, отказана е или е изтекла.'; END IF;
 SELECT v.vehicle_type_id INTO own_type FROM public.vehicles v WHERE v.id=d.vehicle_id AND v.company_id=d.company_id;
 allowed_identity:=d.company_id=r.company_id AND own_type=r.vehicle_type_id;
 IF r.fare_breakdown->'marketplace' IS NOT NULL THEN
  allowed_identity:=EXISTS(SELECT 1 FROM jsonb_array_elements(r.fare_breakdown->'marketplace'->'offers') o
   WHERE o.value->>'company_id'=d.company_id::text AND o.value->>'vehicle_type_id'=own_type::text);
 END IF;
 IF allowed_identity IS DISTINCT FROM true THEN RAISE EXCEPTION 'Request unavailable' USING ERRCODE='42501'; END IF;
 IF NOT d.is_online THEN RAISE EXCEPTION 'DRIVER_OFFLINE: Включи онлайн режим, за да приемаш заявки.'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=d.id AND status IN ('accepted','arrived','in_progress'))
 THEN RAISE EXCEPTION 'DRIVER_BUSY: Вече имаш започнат курс. Отвори текущия курс.'; END IF;
 SELECT * INTO loc FROM public.driver_locations WHERE driver_id=d.id AND company_id=d.company_id;
 IF NOT FOUND OR loc.position_at IS NULL OR loc.updated_at<=clock_timestamp()-interval '45 seconds' OR loc.position_at<=clock_timestamp()-interval '45 seconds'
 OR loc.position_at>clock_timestamp()+interval '30 seconds' OR loc.accuracy IS NULL OR loc.accuracy NOT BETWEEN 0 AND 100
 THEN RAISE EXCEPTION 'GPS_STALE: Няма потвърдена актуална позиция. Обнови GPS и опитай отново.'; END IF;
 IF EXISTS(SELECT 1 FROM public.request_declines WHERE request_id=r.id AND driver_id=d.id)
 THEN RAISE EXCEPTION 'REQUEST_CLOSED: Вече отказа тази заявка. Списъкът се обновява.'; END IF;
 IF NOT private.can_receive_offer(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude,r.fare_breakdown)
 THEN RAISE EXCEPTION 'DRIVER_UNAVAILABLE: Провери верификацията, автомобила и радиуса на фирмата.'; END IF;
 IF r.fare_breakdown->'marketplace' IS NOT NULL THEN RETURN private.accept_marketplace_request(p_request_id); END IF;
 UPDATE public.taxi_requests SET driver_id=d.id,status='accepted',accepted_at=clock_timestamp()
 WHERE id=r.id AND status='pending' RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'REQUEST_CLOSED: Заявката вече не е налична. Списъкът се обновява.'; END IF;
 RETURN r;
END $function$;
CREATE OR REPLACE FUNCTION private.eligible_drivers(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(driver_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.id, d.user_id
  FROM public.drivers d
  JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
  JOIN public.companies c ON c.id=d.company_id AND c.is_active
  JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
  JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
  JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=d.company_id
  WHERE d.company_id=p_company AND v.vehicle_type_id=p_type
    AND (p_user IS NULL OR d.user_id=p_user) AND d.is_online AND d.is_verified AND private.driver_documents_ready(d.id)
    AND l.updated_at > clock_timestamp()-interval '45 seconds'
    AND l.position_at > clock_timestamp()-interval '45 seconds'
    AND l.accuracy BETWEEN 0 AND 100
    AND l.position_at <= clock_timestamp()+interval '30 seconds'
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND c.dispatch_radius_km > 0
    AND public.st_dwithin(l.geo,
      public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
      c.dispatch_radius_km::double precision*1000)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r
      WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$;
CREATE OR REPLACE FUNCTION private.guard_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE d public.drivers;
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','driver_id','accepted_at','arrived_at','started_at','completed_at','cancelled_at','cancelled_by','cancel_reason','final_price','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','driver_id','accepted_at','arrived_at','started_at','completed_at','cancelled_at','cancelled_by','cancel_reason','final_price','updated_at']) THEN
    RAISE EXCEPTION 'Ride identity, route and quote are immutable' USING ERRCODE='42501'; END IF;
  IF NEW.status = OLD.status THEN
    IF (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN RAISE EXCEPTION 'No ride transition requested'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'Ride is already closed'; END IF;
  IF NEW.status='cancelled' THEN
    IF OLD.status='in_progress' AND NOT(public.is_super_admin() OR public.is_company_admin(OLD.company_id)) THEN
      RAISE EXCEPTION 'An active trip must be completed by the driver'; END IF;
    NEW.driver_id:=OLD.driver_id;
    NEW.cancelled_at:=now();
    NEW.cancelled_by:=CASE WHEN auth.uid()=OLD.customer_id THEN 'customer'::public.cancelled_by
      WHEN public.is_driver(OLD.driver_id) THEN 'driver'::public.cancelled_by ELSE 'admin'::public.cancelled_by END;
  ELSE
    IF NOT ((OLD.status='pending' AND NEW.status='accepted') OR (OLD.status='accepted' AND NEW.status='arrived')
      OR (OLD.status='arrived' AND NEW.status='in_progress') OR (OLD.status='in_progress' AND NEW.status='completed')) THEN
      RAISE EXCEPTION 'Invalid ride status transition'; END IF;
    IF NOT public.is_driver(NEW.driver_id) THEN RAISE EXCEPTION 'Only the assigned driver can progress this ride' USING ERRCODE='42501'; END IF;
    IF OLD.status='pending' THEN
      SELECT * INTO d FROM public.drivers WHERE id=NEW.driver_id FOR UPDATE;
      IF d.company_id<>NEW.company_id OR NOT d.is_online OR NOT d.is_verified THEN RAISE EXCEPTION 'Driver must be verified and online'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=d.id AND updated_at>now()-interval '45 seconds') THEN RAISE EXCEPTION 'Driver location is stale'; END IF;
      IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=d.vehicle_id AND company_id=d.company_id AND is_active AND vehicle_type_id=NEW.vehicle_type_id) THEN RAISE EXCEPTION 'Assign an active vehicle matching this ride type'; END IF;
      NEW.accepted_at:=now();
    ELSIF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN RAISE EXCEPTION 'Driver reassignment is forbidden'; END IF;
    IF NEW.status='arrived' THEN NEW.arrived_at:=now(); END IF;
    IF NEW.status='in_progress' THEN NEW.started_at:=now(); END IF;
    IF NEW.status='completed' THEN NEW.completed_at:=now(); END IF;
  END IF;
  -- Clients cannot forge timeline, payment or final amount during a transition.
  IF NEW.status<>'accepted' THEN NEW.accepted_at:=OLD.accepted_at; END IF;
  IF NEW.status<>'arrived' THEN NEW.arrived_at:=OLD.arrived_at; END IF;
  IF NEW.status<>'in_progress' THEN NEW.started_at:=OLD.started_at; END IF;
  IF NEW.status<>'completed' THEN NEW.completed_at:=OLD.completed_at; END IF;
  IF NEW.status<>'cancelled' THEN NEW.cancelled_at:=OLD.cancelled_at; NEW.cancelled_by:=OLD.cancelled_by; NEW.cancel_reason:=OLD.cancel_reason; END IF;
  NEW.final_price:=CASE WHEN NEW.status='completed' THEN OLD.estimated_price ELSE OLD.final_price END;
  RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION private.marketplace_drivers(p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(driver_id uuid, user_id uuid, company_id uuid, vehicle_type_id uuid, service_class text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d.id,d.user_id,d.company_id,v.vehicle_type_id,vt.service_class
 FROM public.driver_locations l
 JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=l.company_id
 JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
 JOIN public.companies c ON c.id=d.company_id AND c.is_active AND c.currency='EUR'
 JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
 JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
 WHERE private.in_bulgaria(p_lat,p_lng) AND (p_user IS NULL OR d.user_id=p_user)
 AND d.is_online AND d.is_verified AND private.driver_documents_ready(d.id)
 AND l.updated_at>clock_timestamp()-interval '45 seconds' AND l.position_at>clock_timestamp()-interval '45 seconds'
 AND l.position_at<=clock_timestamp()+interval '30 seconds' AND l.accuracy BETWEEN 0 AND 100
 AND c.dispatch_radius_km>0
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
  coalesce((SELECT max(dispatch_radius_km)::double precision*1000 FROM public.companies WHERE is_active),0))
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,c.dispatch_radius_km::double precision*1000)
 AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$;
CREATE OR REPLACE FUNCTION private.operational_health(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE result jsonb; budget jsonb; metrics jsonb; stale integer; flagged integer; queue_age numeric;
BEGIN
 IF p_company_id IS NULL OR NOT(public.is_super_admin() OR public.is_company_admin(p_company_id)) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO stale FROM public.drivers d LEFT JOIN public.driver_locations l ON l.driver_id=d.id
  WHERE d.company_id=p_company_id AND d.is_online AND (l.position_at IS NULL OR l.position_at<clock_timestamp()-interval '45 seconds');
 SELECT count(*) INTO flagged FROM public.ride_evidence e WHERE e.company_id=p_company_id
  AND e.updated_at>clock_timestamp()-interval '24 hours' AND cardinality(e.flags)>0;
 SELECT extract(epoch FROM clock_timestamp()-min(o.created_at)) INTO queue_age FROM private.push_outbox o
  JOIN public.taxi_requests r ON r.id=o.request_id WHERE r.company_id=p_company_id AND o.status IN ('pending','processing') AND o.expires_at>clock_timestamp();
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO metrics FROM (
  SELECT value->>'name' name,sum((value->>'count')::int) count,
   sum(CASE WHEN value->>'outcome' IN ('error','timeout') THEN (value->>'count')::int ELSE 0 END) errors,
   round(sum((value->>'totalMs')::numeric)/greatest(1,sum((value->>'count')::int)),1) avg_ms,
   max((value->>'maxMs')::int) max_ms
  FROM private.operation_metric_batches b CROSS JOIN LATERAL jsonb_array_elements(b.rows)
  WHERE b.company_id=p_company_id AND b.received_at>clock_timestamp()-interval '24 hours' GROUP BY value->>'name'
 ) m;
 IF public.is_super_admin() THEN
  SELECT jsonb_build_object('used',coalesce(u.hits,0),'daily_limit',s.daily_limit,'quote_reserve',s.quote_reserve,'user_daily_limit',s.user_daily_limit,'ride_limit',s.ride_limit,'timezone','America/Los_Angeles') INTO budget
   FROM private.route_budget_settings s LEFT JOIN private.route_budget_usage u ON u.bucket='global' AND u.budget_day=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date WHERE s.singleton;
 END IF;
 result:=jsonb_build_object('checked_at',clock_timestamp(),'stale_online_drivers',stale,'flagged_rides_24h',flagged,
  'oldest_push_seconds',coalesce(queue_age,0),'metrics',metrics,'route_budget',budget,
  'company_routes',coalesce((SELECT jsonb_agg(to_jsonb(u)) FROM (SELECT quoted,reserved,denied FROM private.company_route_usage WHERE company_id=p_company_id AND budget_day=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date) u),'[]'::jsonb));
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
CREATE OR REPLACE FUNCTION public.company_driver_page(p_company uuid, p_search text DEFAULT ''::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb; needle text;
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
  ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
  RAISE EXCEPTION 'Нямате достъп до шофьорите на тази фирма.' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page NOT BETWEEN 0 AND 100000 OR length(coalesce(p_search,''))>80 THEN
  RAISE EXCEPTION 'Невалидно търсене или страница.' USING ERRCODE='22023'; END IF;
 needle:=replace(replace(replace(btrim(coalesce(p_search,'')),E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_');
 WITH matching AS MATERIALIZED (
  SELECT d.id,d.user_id,d.company_id,d.created_at,d.is_verified,d.document_verification_required,
   d.rating,d.total_trips,coalesce(d.is_online AND p.is_active,false) AS is_online,
   coalesce(p.first_name,'') AS first_name,coalesce(p.last_name,'') AS last_name,coalesce(p.is_active,false) AS profile_active
  FROM public.drivers d LEFT JOIN public.profiles p ON p.id=d.user_id
  WHERE d.company_id=p_company AND (needle='' OR concat_ws(' ',p.first_name,p.last_name) ILIKE '%'||needle||'%' ESCAPE E'\\')
 ), page AS (
  SELECT * FROM matching ORDER BY created_at DESC,id LIMIT 50 OFFSET p_page*50
 ), rows AS (
  SELECT p.id,p.user_id,p.company_id,p.is_verified,p.document_verification_required,p.rating,p.total_trips,p.is_online,
   p.first_name,p.last_name,p.created_at,l.updated_at AS gps_received_at,l.position_at AS gps_position_at,
   private.fleet_online(p.is_online,p.profile_active,l.updated_at,l.position_at,current_timestamp) AS online_now
  FROM page p LEFT JOIN public.driver_locations l ON l.driver_id=p.id AND l.company_id=p_company
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matching),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(r)-'created_at' ORDER BY r.created_at DESC,r.id) FROM rows r),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$;
CREATE OR REPLACE FUNCTION public.company_fleet(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Fleet scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH visible AS MATERIALIZED (
   SELECT d.id,p.first_name,p.last_name,private.fleet_online(d.is_online,p.is_active,l.updated_at,l.position_at,current_timestamp) AS is_online,l.latitude,l.longitude,l.updated_at,l.position_at
   FROM public.driver_locations l JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=p_company
   JOIN public.profiles p ON p.id=d.user_id
   WHERE l.company_id=p_company
 ), page AS (
   SELECT * FROM visible ORDER BY is_online DESC,updated_at DESC,id LIMIT 500
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM visible),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.is_online DESC,p.updated_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $function$;
DROP FUNCTION private.fleet_online(boolean,boolean,timestamptz,timestamptz,timestamptz,double precision);
DROP FUNCTION private.location_is_current(timestamptz,timestamptz,double precision,timestamptz);
NOTIFY pgrst,'reload schema';
COMMIT;
