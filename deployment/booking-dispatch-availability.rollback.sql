BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method payment_method DEFAULT 'cash'::payment_method)
 RETURNS taxi_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE q public.ride_quotes; r public.taxi_requests; b jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='CUSTOMER' AND is_active) THEN
    RAISE EXCEPTION 'Active customer account required' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM public.ride_quotes WHERE id=p_quote_id AND customer_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quote not found' USING ERRCODE='42501'; END IF;
  IF q.request_id IS NOT NULL THEN SELECT * INTO r FROM public.taxi_requests WHERE id=q.request_id; RETURN r; END IF;
  IF q.expires_at<now() THEN RAISE EXCEPTION 'Quote expired. Refresh the route and price.'; END IF;
  IF p_request_id IS NULL OR p_payment_method<>'cash' THEN RAISE EXCEPTION 'Only cash payment is available for now'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=q.company_id AND is_active) THEN RAISE EXCEPTION 'Company unavailable'; END IF;
  b:=q.payload;
  INSERT INTO public.taxi_requests(id,company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
    destination_latitude,destination_longitude,destination_address,estimated_distance_km,estimated_duration_min,estimated_price,fare_breakdown,payment_method)
  VALUES(p_request_id,q.company_id,auth.uid(),q.vehicle_type_id,(b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8,b->>'pickup_address',
    (b->>'destination_latitude')::float8,(b->>'destination_longitude')::float8,b->>'destination_address',(b->>'distance_km')::float8,
    (b->>'duration_min')::integer,(b->>'total')::numeric,b->'breakdown',p_payment_method) RETURNING * INTO r;
  UPDATE public.ride_quotes SET request_id=r.id WHERE id=q.id;
  RETURN r;
END $function$
;
CREATE OR REPLACE FUNCTION private.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); company uuid; allowed boolean; result jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role='CUSTOMER' AND is_active) THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 41 AND 45 OR p_lng NOT BETWEEN 22 AND 29 OR private.in_bulgaria(p_lat,p_lng) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location outside service area'; END IF;
 INSERT INTO private.nearby_read_limits VALUES(actor,clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET last_read=EXCLUDED.last_read WHERE private.nearby_read_limits.last_read<clock_timestamp()-interval '8 seconds' RETURNING true INTO allowed;
 IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retry later' USING ERRCODE='P0001'; END IF;
 SELECT COALESCE(p.company_id,(SELECT c.id FROM public.companies c WHERE c.is_active ORDER BY c.created_at,c.id LIMIT 1)) INTO company FROM public.profiles p WHERE p.id=actor;
 SELECT COALESCE(jsonb_agg(to_jsonb(cars)),'[]'::jsonb) INTO result FROM (
 SELECT md5(d.id::text||actor::text||current_date::text) AS token,
 round(l.latitude::numeric,4)::double precision AS lat,round(l.longitude::numeric,4)::double precision AS lng,
 l.heading,l.speed,greatest(l.accuracy,20) AS accuracy,l.position_at,l.updated_at
 FROM public.drivers d JOIN public.vehicles v ON v.id=d.vehicle_id
 JOIN public.driver_locations l ON l.driver_id=d.id
 CROSS JOIN LATERAL private.eligible_drivers(company,v.vehicle_type_id,p_lat,p_lng,d.user_id) eligible
 WHERE d.company_id=company AND eligible.driver_id=d.id AND (p_type IS NULL OR v.vehicle_type_id=p_type)
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,1500)
 ORDER BY l.geo OPERATOR(public.<->) public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography LIMIT 12
 ) cars;
 RETURN jsonb_build_object('cars',result,'sampled_at',clock_timestamp());
END $function$
;
DROP FUNCTION IF EXISTS public.booking_availability(uuid,double precision,double precision);
DROP FUNCTION IF EXISTS private.booking_availability(uuid,double precision,double precision);
NOTIFY pgrst,'reload schema';
COMMIT;

