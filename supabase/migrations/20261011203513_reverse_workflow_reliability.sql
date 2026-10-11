-- Safe retries return an owned ride without replaying its state transition.
-- Keep SECURITY INVOKER and existing grants: RLS still controls every read/write.
CREATE OR REPLACE FUNCTION public.accept_taxi_request(p_request_id uuid)
 RETURNS taxi_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests; d public.drivers;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
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
END $function$;

-- Refusals can only be recorded for a visible, live pending offer.
-- Visibility applies taxi_requests RLS (company, location, vehicle and readiness).
ALTER POLICY request_declines_insert ON public.request_declines TO authenticated
WITH CHECK (
  (SELECT auth.uid()) IS NOT NULL AND public.is_driver(driver_id)
  AND EXISTS (
    SELECT 1 FROM public.taxi_requests r
    WHERE r.id = request_declines.request_id AND r.status = 'pending'
      AND clock_timestamp() < COALESCE(r.expires_at, r.created_at + interval '2 minutes')
  )
);
