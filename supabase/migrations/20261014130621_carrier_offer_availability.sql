-- Existing clients keep their category counts. Exact-carrier clients also need
-- the eligible company/type pairs; no driver identity or position is exposed.
CREATE OR REPLACE FUNCTION private.marketplace_availability(p_lat double precision, p_lng double precision)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE snapshot jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'CUSTOMER' AND is_active)
  THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE = '42501'; END IF;
  IF private.in_bulgaria(p_lat, p_lng) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Location outside service area'; END IF;

  WITH ready AS MATERIALIZED (
    SELECT company_id, vehicle_type_id, service_class FROM private.marketplace_drivers(p_lat, p_lng)
  ), counts AS (
    SELECT service_class, count(*) amount FROM ready GROUP BY service_class
  ), pairs AS (
    SELECT DISTINCT company_id, vehicle_type_id, service_class FROM ready
  )
  SELECT jsonb_build_object(
    'company_id', 'marketplace', 'sampled_at', clock_timestamp(),
    'categories', (
      SELECT jsonb_agg(jsonb_build_object('id', s.class, 'configured', coalesce(c.amount, 0) > 0,
        'drivers', coalesce(c.amount, 0)) ORDER BY s.rank)
      FROM (VALUES ('standard', 1), ('comfort', 2), ('van', 3)) s(class, rank)
      LEFT JOIN counts c ON c.service_class = s.class
    ),
    'carriers', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('company_id', company_id,
        'vehicle_type_id', vehicle_type_id, 'service_class', service_class)
        ORDER BY company_id, vehicle_type_id), '[]'::jsonb) FROM pairs
    )
  ) INTO snapshot;
  RETURN snapshot;
END $function$;
