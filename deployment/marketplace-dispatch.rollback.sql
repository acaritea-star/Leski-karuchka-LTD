-- Restore exact live function definitions and dispatch policies captured before marketplace cutover.
-- Publish the prior frontend and restore the prior google-routes bundle together.
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
  IF NOT EXISTS(SELECT 1 FROM private.eligible_drivers(q.company_id,q.vehicle_type_id,
    (b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8)) THEN
    RAISE EXCEPTION 'NO_AVAILABLE_DRIVER: Няма свободен шофьор за избраната фирма и категория. Избери друга категория или опитай отново.';
  END IF;
  INSERT INTO public.taxi_requests(id,company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
    destination_latitude,destination_longitude,destination_address,estimated_distance_km,estimated_duration_min,estimated_price,fare_breakdown,payment_method)
  VALUES(p_request_id,q.company_id,auth.uid(),q.vehicle_type_id,(b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8,b->>'pickup_address',
    (b->>'destination_latitude')::float8,(b->>'destination_longitude')::float8,b->>'destination_address',(b->>'distance_km')::float8,
    (b->>'duration_min')::integer,(b->>'total')::numeric,b->'breakdown',p_payment_method) RETURNING * INTO r;
  UPDATE public.ride_quotes SET request_id=r.id WHERE id=q.id;
  RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION private.enqueue_request_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE recipient uuid; recipients uuid[]; kind text; title text; message text; role_name text;
  payload jsonb; deadline timestamptz; notification_type text;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RETURN NEW; END IF;
  kind:=CASE WHEN NEW.status='pending' THEN 'new_request' ELSE NEW.status::text END;
  IF kind='new_request' THEN
    SELECT array_agg(user_id) INTO recipients FROM public.request_push_recipients(NEW.id);
    title:='Нова заявка'; message:=NEW.pickup_address||' → '||NEW.destination_address;
    deadline:=COALESCE(NEW.expires_at,NEW.created_at+interval '2 minutes');
  ELSE
    recipients:=ARRAY[NEW.customer_id];
    IF kind='cancelled' AND NEW.driver_id IS NOT NULL THEN
      SELECT array_append(recipients,d.user_id) INTO recipients FROM public.drivers d WHERE d.id=NEW.driver_id;
    END IF;
    title:=CASE kind WHEN 'accepted' THEN 'Шофьор прие заявката'
      WHEN 'arrived' THEN 'Шофьорът пристигна' WHEN 'in_progress' THEN 'Курсът започна'
      WHEN 'completed' THEN 'Курсът приключи'
      WHEN 'cancelled' THEN CASE WHEN NEW.cancel_reason='no_driver' THEN 'Няма наличен шофьор' ELSE 'Заявката е отказана' END END;
    message:=CASE kind WHEN 'accepted' THEN 'Отвори приложението за подробности.'
      WHEN 'arrived' THEN 'Шофьорът те очаква на мястото за вземане.'
      WHEN 'in_progress' THEN 'Можеш да следиш курса в приложението.'
      WHEN 'completed' THEN 'Благодарим ти. Виж подробностите в приложението.'
      WHEN 'cancelled' THEN CASE WHEN NEW.cancel_reason='no_driver' THEN 'Опитай отново след малко.' ELSE 'Виж актуалния статус в приложението.' END END;
    deadline:=clock_timestamp()+interval '5 minutes';
  END IF;
  notification_type:=CASE WHEN kind='new_request' THEN 'new_request'
    WHEN kind='cancelled' AND NEW.cancel_reason='no_driver' THEN 'no_driver' ELSE 'trip_status' END;
  FOREACH recipient IN ARRAY COALESCE(recipients,ARRAY[]::uuid[]) LOOP
    IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=recipient AND is_active) THEN CONTINUE; END IF;
    role_name:=CASE WHEN recipient=NEW.customer_id THEN 'CUSTOMER' ELSE 'DRIVER' END;
    payload:=jsonb_build_object('title',title,'body',CASE WHEN kind='new_request' THEN 'Има заявка близо до теб. Отвори приложението за подробности.' ELSE message END,'icon','/icon-192.png','badge','/badge-72.png',
      'tag','request-'||NEW.id||'-'||kind,'renotify',false,'requireInteraction',kind IN ('new_request','arrived'),
      'data',jsonb_build_object('request_id',NEW.id,'type',notification_type,'role',role_name,
        'status',NEW.status,'reason',NEW.cancel_reason,'expires_at',deadline));
    INSERT INTO private.push_outbox(request_id,recipient_id,event_type,payload,expires_at)
      VALUES(NEW.id,recipient,kind,payload,deadline) ON CONFLICT DO NOTHING;
    IF FOUND THEN
      INSERT INTO public.notifications(user_id,company_id,type,title,message,data,is_read)
        VALUES(recipient,NEW.company_id,notification_type,title,message,payload->'data',false);
    END IF;
  END LOOP;
  PERFORM private.dispatch_push_outbox();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION private.guard_request_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF OLD.status='pending' AND NEW.status='accepted' THEN
    IF clock_timestamp() >= COALESCE(OLD.expires_at,OLD.created_at+interval '2 minutes') THEN
      RAISE EXCEPTION 'Заявката е изтекла. Обнови списъка.' USING ERRCODE='P0001';
    END IF;
    IF current_user NOT IN ('postgres','service_role','supabase_admin')
      AND NOT private.can_receive_request(OLD.company_id,OLD.vehicle_type_id,OLD.pickup_latitude,OLD.pickup_longitude) THEN
      RAISE EXCEPTION 'Driver is outside the dispatch area or unavailable' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ SELECT private.nearby_cars(p_lat,p_lng,p_type); $function$;

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
 SELECT COALESCE(p.company_id,(SELECT vt.company_id FROM public.vehicle_types vt JOIN public.companies c ON c.id=vt.company_id WHERE vt.id=p_type AND vt.is_active AND c.is_active),(SELECT c.id FROM public.companies c WHERE c.is_active ORDER BY c.created_at,c.id LIMIT 1)) INTO company FROM public.profiles p WHERE p.id=actor;
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
END $function$;

CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
 RETURNS TABLE(user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.user_id FROM public.taxi_requests r
  CROSS JOIN LATERAL private.eligible_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude) d
  WHERE r.id=p_request_id AND r.status='pending'
    AND clock_timestamp()<COALESCE(r.expires_at,r.created_at+interval '2 minutes');
$function$;

ALTER POLICY taxi_requests_select_driver ON public.taxi_requests USING (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude))));
ALTER POLICY taxi_requests_update_driver ON public.taxi_requests USING (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude)))) WITH CHECK (((driver_id = ( SELECT private.current_driver_id() AS current_driver_id)) OR is_company_admin(company_id) OR ( SELECT is_super_admin() AS is_super_admin)));
DROP POLICY IF EXISTS driver_offer_broadcast_receive ON realtime.messages;
DROP FUNCTION IF EXISTS public.driver_incoming_requests(integer);
DROP FUNCTION IF EXISTS public.save_vehicle_category(uuid,uuid,timestamptz,jsonb);
DROP FUNCTION IF EXISTS public.marketplace_availability(double precision,double precision);
DROP FUNCTION IF EXISTS private.marketplace_availability(double precision,double precision);
DROP FUNCTION IF EXISTS private.accept_marketplace_request(uuid);
DROP FUNCTION IF EXISTS private.can_receive_offer(uuid,uuid,double precision,double precision,jsonb);
DROP FUNCTION IF EXISTS private.eligible_offer_drivers(uuid,uuid,double precision,double precision,jsonb,uuid);
DROP FUNCTION IF EXISTS public.marketplace_quote_types(double precision,double precision);
DROP FUNCTION IF EXISTS private.marketplace_types(double precision,double precision);
DROP FUNCTION IF EXISTS private.marketplace_drivers(double precision,double precision,uuid);
NOTIFY pgrst,'reload schema';
COMMIT;
