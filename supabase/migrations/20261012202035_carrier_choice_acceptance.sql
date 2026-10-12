-- Exact firm quotes use existing fixed-company dispatch. Shared quotes stay valid.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.marketplace_quote_types(p_lat double precision,p_lng double precision)
 RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('company_name',c.name,'type_name',vt.name,'capacity',vt.capacity)
 ORDER BY t.service_class,t.company_id,t.id),'[]'::jsonb)
 FROM private.marketplace_types(p_lat,p_lng) t
 JOIN public.companies c ON c.id=t.company_id
 JOIN public.vehicle_types vt ON vt.id=t.id AND vt.company_id=t.company_id;
$$;

-- RLS hides stale/ineligible pending rows. Resolve the operation inside the
-- validated server boundary so a GPS failure is not reported as a taken ride.
CREATE FUNCTION private.accept_request(p_request_id uuid)
 RETURNS public.taxi_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
END $$;
REVOKE ALL ON FUNCTION private.accept_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accept_request(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.accept_taxi_request(p_request_id uuid)
 RETURNS public.taxi_requests LANGUAGE sql SET search_path='' AS $$ SELECT private.accept_request(p_request_id); $$;
-- Existing RPC grants and all table policies remain unchanged.
NOTIFY pgrst,'reload schema';
COMMIT;
