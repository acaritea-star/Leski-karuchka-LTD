-- Cross-company dispatch. Legacy fixed-company quotes remain valid.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.vehicle_types ADD COLUMN service_class text NOT NULL DEFAULT 'standard'
 CHECK(service_class IN ('standard','comfort','van'));
UPDATE public.vehicle_types SET service_class=CASE
 WHEN name ~* '(comfort|комфорт)' THEN 'comfort'
 WHEN capacity>4 OR name ~* '(van|ван|bus|бус)' THEN 'van' ELSE 'standard' END;
CREATE INDEX vehicle_types_marketplace_class ON public.vehicle_types(service_class,company_id) WHERE is_active;

-- One spatially bounded scan rather than one scan per registered firm.
CREATE FUNCTION private.marketplace_drivers(p_lat double precision,p_lng double precision,p_user uuid DEFAULT NULL)
 RETURNS TABLE(driver_id uuid,user_id uuid,company_id uuid,vehicle_type_id uuid,service_class text)
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
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
$$;
REVOKE ALL ON FUNCTION private.marketplace_drivers(double precision,double precision,uuid) FROM PUBLIC,anon,authenticated;

-- Only anonymous category counts reach customers; every driver still has fresh GPS,
-- validated documents, an active car and no active ride, using its company's radius.
CREATE FUNCTION private.marketplace_types(p_lat double precision,p_lng double precision)
 RETURNS TABLE(id uuid,company_id uuid,service_class text,multiplier numeric,
 base_fare numeric,price_per_km numeric,price_per_minute numeric,min_fare numeric,currency text)
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT vt.id,c.id,vt.service_class,vt.multiplier,c.base_fare,c.price_per_km,c.price_per_minute,c.min_fare,c.currency::text
 FROM private.marketplace_drivers(p_lat,p_lng) d JOIN public.vehicle_types vt ON vt.id=d.vehicle_type_id
 JOIN public.companies c ON c.id=d.company_id
 ORDER BY vt.service_class,c.id,vt.id;
$$;
REVOKE ALL ON FUNCTION private.marketplace_types(double precision,double precision) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.marketplace_quote_types(p_lat double precision,p_lng double precision)
 RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) FROM private.marketplace_types(p_lat,p_lng) t;
$$;
REVOKE ALL ON FUNCTION public.marketplace_quote_types(double precision,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.marketplace_types(double precision,double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketplace_quote_types(double precision,double precision) TO service_role;

CREATE FUNCTION private.marketplace_availability(p_lat double precision,p_lng double precision)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE categories jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='CUSTOMER' AND is_active)
 THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF private.in_bulgaria(p_lat,p_lng) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location outside service area'; END IF;
 WITH ready AS MATERIALIZED (SELECT service_class,count(*) amount FROM private.marketplace_drivers(p_lat,p_lng) GROUP BY service_class)
 SELECT jsonb_agg(jsonb_build_object('id',s.class,'configured',coalesce(ready.amount,0)>0,'drivers',coalesce(ready.amount,0)) ORDER BY s.rank) INTO categories
 FROM (VALUES('standard',1),('comfort',2),('van',3)) s(class,rank) LEFT JOIN ready ON ready.service_class=s.class;
 RETURN jsonb_build_object('company_id','marketplace','sampled_at',clock_timestamp(),'categories',categories);
END $$;
REVOKE ALL ON FUNCTION private.marketplace_availability(double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.marketplace_availability(double precision,double precision) TO authenticated;
CREATE FUNCTION public.marketplace_availability(p_lat double precision,p_lng double precision)
 RETURNS jsonb LANGUAGE sql SET search_path='' AS $$ SELECT private.marketplace_availability(p_lat,p_lng); $$;
REVOKE ALL ON FUNCTION public.marketplace_availability(double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.marketplace_availability(double precision,double precision) TO authenticated;

-- Financial offers are server-written quote snapshots, never browser input.
CREATE FUNCTION private.eligible_offer_drivers(p_company uuid,p_type uuid,p_lat double precision,p_lng double precision,
 p_fare jsonb,p_user uuid DEFAULT NULL)
 RETURNS TABLE(driver_id uuid,user_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT d.driver_id,d.user_id FROM private.eligible_drivers(p_company,p_type,p_lat,p_lng,p_user) d
 WHERE p_fare->'marketplace' IS NULL
 UNION
 SELECT d.driver_id,d.user_id FROM private.marketplace_drivers(p_lat,p_lng,p_user) d
 JOIN jsonb_to_recordset(p_fare->'marketplace'->'offers') o(company_id uuid,vehicle_type_id uuid,total numeric,breakdown jsonb)
 ON o.company_id=d.company_id AND o.vehicle_type_id=d.vehicle_type_id
 WHERE d.service_class=p_fare->'marketplace'->>'service_class';
$$;
REVOKE ALL ON FUNCTION private.eligible_offer_drivers(uuid,uuid,double precision,double precision,jsonb,uuid) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.can_receive_offer(p_company uuid,p_type uuid,p_lat double precision,p_lng double precision,p_fare jsonb)
 RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
 SELECT 1 FROM private.eligible_offer_drivers(p_company,p_type,p_lat,p_lng,p_fare,auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.can_receive_offer(uuid,uuid,double precision,double precision,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_receive_offer(uuid,uuid,double precision,double precision,jsonb) TO authenticated;
ALTER POLICY taxi_requests_select_driver ON public.taxi_requests USING (
 driver_id=(SELECT private.current_driver_id()) OR public.is_company_admin(company_id) OR (SELECT public.is_super_admin())
 OR (status='pending' AND clock_timestamp()<coalesce(expires_at,created_at+interval '2 minutes')
 AND private.can_receive_offer(company_id,vehicle_type_id,pickup_latitude,pickup_longitude,fare_breakdown)));
ALTER POLICY taxi_requests_update_driver ON public.taxi_requests USING (
 driver_id=(SELECT private.current_driver_id())
 OR (status='pending' AND clock_timestamp()<coalesce(expires_at,created_at+interval '2 minutes')
 AND private.can_receive_offer(company_id,vehicle_type_id,pickup_latitude,pickup_longitude,fare_breakdown)));
CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
 RETURNS TABLE(user_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT d.user_id FROM public.taxi_requests r
 CROSS JOIN LATERAL private.eligible_offer_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude,r.fare_breakdown) d
 WHERE r.id=p_request_id AND r.status='pending' AND clock_timestamp()<coalesce(r.expires_at,r.created_at+interval '2 minutes');
$$;

-- Keep read/write concurrency and double-tap protection; bind the winning operator
-- and its exact, immutable tariff before financial, audit and evidence triggers.
CREATE FUNCTION private.accept_marketplace_request(p_request_id uuid)
 RETURNS public.taxi_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.taxi_requests; d public.drivers; offer jsonb; market jsonb; fare numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND role='DRIVER' AND is_active)
 THEN RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
 SELECT * INTO d FROM public.drivers WHERE user_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501'; END IF;
 IF r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress','completed') THEN RETURN r; END IF;
 market:=r.fare_breakdown->'marketplace';
 IF market IS NULL OR r.status<>'pending' OR clock_timestamp()>=coalesce(r.expires_at,r.created_at+interval '2 minutes')
 OR NOT EXISTS(SELECT 1 FROM private.eligible_offer_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude,r.fare_breakdown,auth.uid()))
 THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
 SELECT o.value INTO offer FROM jsonb_array_elements(market->'offers') o
 JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id
 WHERE o.value->>'company_id'=d.company_id::text AND o.value->>'vehicle_type_id'=v.vehicle_type_id::text;
 fare:=(offer->>'total')::numeric;
 IF offer IS NULL OR fare IS NULL OR fare<(market->>'min')::numeric OR fare>(market->>'max')::numeric
 OR fare IS DISTINCT FROM (offer->'breakdown'->>'total')::numeric THEN RAISE EXCEPTION 'Invalid saved fare'; END IF;
 UPDATE public.taxi_requests SET company_id=d.company_id,vehicle_type_id=(offer->>'vehicle_type_id')::uuid,
  driver_id=d.id,status='accepted',accepted_at=clock_timestamp(),estimated_price=fare,
  fare_breakdown=(offer->'breakdown')||jsonb_build_object('marketplace',market)
 WHERE id=r.id AND status='pending' RETURNING * INTO r;
 IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(d.company_id,auth.uid(),'taxi_request',r.id,'marketplace_carrier_assigned',
 jsonb_build_object('company_id',r.company_id,'vehicle_type_id',r.vehicle_type_id,'price',fare,'quoted_min',market->'min','quoted_max',market->'max'));
 RETURN r;
END $$;
REVOKE ALL ON FUNCTION private.accept_marketplace_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accept_marketplace_request(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_request_dispatch() RETURNS trigger
 LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF OLD.status='pending' AND NEW.status='accepted' THEN
  IF clock_timestamp()>=coalesce(OLD.expires_at,OLD.created_at+interval '2 minutes') THEN
   RAISE EXCEPTION 'Заявката е изтекла. Обнови списъка.'; END IF;
  IF OLD.fare_breakdown->'marketplace' IS NOT NULL AND current_user NOT IN ('postgres','service_role','supabase_admin') THEN
   RAISE EXCEPTION 'Use the validated acceptance operation' USING ERRCODE='42501'; END IF;
  IF current_user NOT IN ('postgres','service_role','supabase_admin')
   AND NOT private.can_receive_offer(OLD.company_id,OLD.vehicle_type_id,OLD.pickup_latitude,OLD.pickup_longitude,OLD.fare_breakdown)
  THEN RAISE EXCEPTION 'Driver is outside the dispatch area or unavailable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Driver-specific offer price. RLS limits the pending rows before projection.
CREATE FUNCTION public.driver_incoming_requests(p_limit integer DEFAULT 50)
 RETURNS SETOF public.taxi_requests LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.taxi_requests; own public.drivers; offer jsonb;
BEGIN
 SELECT * INTO own FROM public.drivers WHERE user_id=auth.uid() AND public.is_driver(id);
 IF NOT FOUND OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Active driver required' USING ERRCODE='42501'; END IF;
 FOR r IN SELECT * FROM public.taxi_requests WHERE status='pending'
  AND clock_timestamp()<coalesce(expires_at,created_at+interval '2 minutes')
  AND private.can_receive_offer(company_id,vehicle_type_id,pickup_latitude,pickup_longitude,fare_breakdown)
  ORDER BY created_at DESC LIMIT p_limit LOOP
  IF r.fare_breakdown->'marketplace' IS NOT NULL THEN
   SELECT o.value INTO offer FROM jsonb_array_elements(r.fare_breakdown->'marketplace'->'offers') o
    JOIN public.vehicles v ON v.id=own.vehicle_id
    WHERE o.value->>'company_id'=own.company_id::text AND o.value->>'vehicle_type_id'=v.vehicle_type_id::text;
   r.estimated_price:=(offer->>'total')::numeric;
   r.fare_breakdown:=offer->'breakdown'||jsonb_build_object('marketplace',r.fare_breakdown->'marketplace');
  END IF;
  RETURN NEXT r;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.driver_incoming_requests(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_incoming_requests(integer) TO authenticated;

-- The category editor keeps vehicle assignment and category ownership separate.
CREATE FUNCTION public.save_vehicle_category(p_id uuid,p_company uuid,p_expected_at timestamptz,p_details jsonb)
 RETURNS public.vehicle_types LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result public.vehicle_types; label text:=btrim(p_details->>'name'); cls text:=p_details->>'service_class';
 cap integer:=(p_details->>'capacity')::integer; mult numeric:=(p_details->>'multiplier')::numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_company_admin(p_company) OR public.is_super_admin())
 THEN RAISE EXCEPTION 'Company administrator required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR label IS NULL OR length(label) NOT BETWEEN 2 AND 60 OR cls IS NULL OR cls NOT IN ('standard','comfort','van')
 OR cap IS NULL OR cap NOT BETWEEN 1 AND 8 OR mult IS NULL OR mult<=0 OR mult>10
 OR (cls='van' AND cap<5) OR (cls<>'van' AND cap>4) THEN RAISE EXCEPTION 'Invalid vehicle category'; END IF;
 IF p_expected_at IS NULL THEN
  INSERT INTO public.vehicle_types(id,company_id,name,service_class,capacity,multiplier,is_active)
   VALUES(p_id,p_company,label,cls,cap,mult,coalesce((p_details->>'is_active')::boolean,true))
   ON CONFLICT(id) DO NOTHING RETURNING * INTO result;
  IF NOT FOUND THEN
   SELECT * INTO result FROM public.vehicle_types WHERE id=p_id AND company_id=p_company;
   IF NOT FOUND OR result.name<>label OR result.service_class<>cls OR result.capacity<>cap OR result.multiplier<>mult
    OR result.is_active IS DISTINCT FROM coalesce((p_details->>'is_active')::boolean,true)
    THEN RAISE EXCEPTION 'Category save conflict'; END IF;
  END IF;
 ELSE
  UPDATE public.vehicle_types SET name=label,service_class=cls,capacity=cap,multiplier=mult,
   is_active=coalesce((p_details->>'is_active')::boolean,true)
   WHERE id=p_id AND company_id=p_company AND updated_at=p_expected_at RETURNING * INTO result;
  IF NOT FOUND THEN RAISE EXCEPTION 'Категорията е променена. Обнови списъка.'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.save_vehicle_category(uuid,uuid,timestamptz,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_vehicle_category(uuid,uuid,timestamptz,jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.create_taxi_request(p_quote_id uuid, p_request_id uuid, p_payment_method public.payment_method DEFAULT 'cash'::payment_method)
 RETURNS public.taxi_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
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
  IF NOT EXISTS(SELECT 1 FROM private.eligible_offer_drivers(q.company_id,q.vehicle_type_id,
    (b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8,b->'breakdown')) THEN
    RAISE EXCEPTION 'NO_AVAILABLE_DRIVER: Няма свободен шофьор за тази категория около началния адрес. Избери друга категория или опитай отново.';
  END IF;
  INSERT INTO public.taxi_requests(id,company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
    destination_latitude,destination_longitude,destination_address,estimated_distance_km,estimated_duration_min,estimated_price,fare_breakdown,payment_method)
  VALUES(p_request_id,q.company_id,auth.uid(),q.vehicle_type_id,(b->>'pickup_latitude')::float8,(b->>'pickup_longitude')::float8,b->>'pickup_address',
    (b->>'destination_latitude')::float8,(b->>'destination_longitude')::float8,b->>'destination_address',(b->>'distance_km')::float8,
    (b->>'duration_min')::integer,(b->>'total')::numeric,b->'breakdown',p_payment_method) RETURNING * INTO r;
  UPDATE public.ride_quotes SET request_id=r.id WHERE id=q.id;
  RETURN r;
END $function$
;

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
END $function$;


CREATE OR REPLACE FUNCTION private.nearby_cars(p_lat double precision, p_lng double precision, p_type uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE actor uuid:=auth.uid(); allowed boolean; result jsonb;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role='CUSTOMER' AND is_active) THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN 41 AND 45 OR p_lng NOT BETWEEN 22 AND 29 OR private.in_bulgaria(p_lat,p_lng) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Location outside service area'; END IF;
 INSERT INTO private.nearby_read_limits VALUES(actor,clock_timestamp()) ON CONFLICT(user_id) DO UPDATE SET last_read=EXCLUDED.last_read WHERE private.nearby_read_limits.last_read<clock_timestamp()-interval '8 seconds' RETURNING true INTO allowed;
 IF allowed IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retry later' USING ERRCODE='P0001'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(cars)),'[]'::jsonb) INTO result FROM (
 SELECT md5(d.id::text||actor::text||current_date::text) AS token,
 round(l.latitude::numeric,4)::double precision AS lat,round(l.longitude::numeric,4)::double precision AS lng,
 l.heading,l.speed,greatest(l.accuracy,20) AS accuracy,l.position_at,l.updated_at
 FROM public.drivers d JOIN public.vehicles v ON v.id=d.vehicle_id
 JOIN public.driver_locations l ON l.driver_id=d.id
 CROSS JOIN LATERAL private.eligible_drivers(d.company_id,v.vehicle_type_id,p_lat,p_lng,d.user_id) eligible
 WHERE eligible.driver_id=d.id AND (p_type IS NULL OR v.vehicle_type_id=p_type)
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,1500)
 ORDER BY l.geo OPERATOR(public.<->) public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography LIMIT 12
 ) cars;
 RETURN jsonb_build_object('cars',result,'sampled_at',clock_timestamp());
END $function$
;

-- A driver receives only its own minimal hint; clients cannot send offers.
CREATE POLICY driver_offer_broadcast_receive ON realtime.messages FOR SELECT TO authenticated
 USING(extension='broadcast' AND (SELECT realtime.topic())='driver-offers:'||(SELECT auth.uid())::text
 AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND role='DRIVER' AND is_active));
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
      BEGIN
        IF kind='new_request' THEN
          PERFORM realtime.send(jsonb_build_object('request_id',NEW.id),'offer_changed','driver-offers:'||recipient::text,true);
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL; END;
      INSERT INTO public.notifications(user_id,company_id,type,title,message,data,is_read)
        VALUES(recipient,NEW.company_id,notification_type,title,message,payload->'data',false);
    END IF;
  END LOOP;
  IF kind<>'new_request' THEN
    FOR recipient IN SELECT recipient_id FROM private.push_outbox WHERE request_id=NEW.id AND event_type='new_request' LOOP
      BEGIN
        PERFORM realtime.send(jsonb_build_object('request_id',NEW.id),'offer_changed','driver-offers:'||recipient::text,true);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;
  END IF;
  PERFORM private.dispatch_push_outbox();
  RETURN NEW;
END $function$
NOTIFY pgrst,'reload schema';
COMMIT;
