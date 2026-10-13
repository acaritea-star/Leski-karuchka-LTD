-- Exact pre-release definitions; does not change table data or policies.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.accept_taxi_request(p_request_id uuid)
 RETURNS taxi_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests; d public.drivers;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  IF r.fare_breakdown->'marketplace' IS NOT NULL THEN RETURN private.accept_marketplace_request(p_request_id); END IF;
  SELECT * INTO d FROM public.drivers
    WHERE user_id=auth.uid() AND company_id=r.company_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN
    RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501';
  END IF;
  IF r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress','completed') THEN RETURN r; END IF;
  IF r.status<>'pending' OR clock_timestamp()>=COALESCE(r.expires_at,r.created_at+interval '2 minutes') THEN
    RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.';
  END IF;
  UPDATE public.taxi_requests SET driver_id=d.id,status='accepted'
    WHERE id=r.id AND status='pending' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  RETURN r;
END $function$
;
CREATE OR REPLACE FUNCTION public.marketplace_quote_types(p_lat double precision, p_lng double precision)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM private.marketplace_types(p_lat,p_lng) t;
$function$
;
DROP FUNCTION private.accept_request(uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
