-- Existing project upgrade. No customer, trip or payment history is removed.
-- Private authorization guards are invoked by triggers, never as public RPCs.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE role_name text := COALESCE(NEW.raw_app_meta_data->>'role','CUSTOMER'); company uuid;
BEGIN
  IF role_name NOT IN ('CUSTOMER','DRIVER','COMPANY_ADMIN','SUPER_ADMIN') THEN role_name := 'CUSTOMER'; END IF;
  BEGIN company := (NEW.raw_app_meta_data->>'company_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN company := NULL; END;
  IF company IS NULL AND role_name = 'CUSTOMER' THEN
    SELECT id INTO company FROM public.companies WHERE is_active ORDER BY created_at,id LIMIT 1;
  END IF;
  INSERT INTO public.profiles(id,email,role,company_id,first_name,last_name,phone,is_active)
  VALUES(NEW.id,NEW.email,role_name::public.user_role,company,
    COALESCE(NEW.raw_user_meta_data->>'first_name',split_part(NEW.raw_user_meta_data->>'full_name',' ',1),''),
    COALESCE(NEW.raw_user_meta_data->>'last_name',''),COALESCE(NEW.raw_user_meta_data->>'phone',''),true)
  ON CONFLICT(id) DO NOTHING;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.guard_profile() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF public.is_super_admin() THEN RETURN NEW; END IF;
  IF public.is_company_admin(OLD.company_id) THEN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.id <> OLD.id
      OR (NEW.role IS DISTINCT FROM OLD.role AND NEW.role NOT IN ('CUSTOMER','DRIVER'))
      OR OLD.role = 'SUPER_ADMIN' THEN RAISE EXCEPTION 'Forbidden profile administration' USING ERRCODE='42501'; END IF;
  ELSIF (to_jsonb(NEW) - ARRAY['first_name','last_name','phone','avatar_url','language','updated_at'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['first_name','last_name','phone','avatar_url','language','updated_at']) THEN
    RAISE EXCEPTION 'Only personal profile fields may be edited' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_profile BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.guard_profile();

ALTER TABLE public.driver_locations ADD COLUMN IF NOT EXISTS position_at timestamptz;
CREATE OR REPLACE FUNCTION private.guard_location() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT (NEW.latitude BETWEEN -90 AND 90 AND NEW.longitude BETWEEN -180 AND 180)
    OR NEW.accuracy < 0 OR NEW.accuracy > 1000 THEN RAISE EXCEPTION 'Invalid GPS coordinates or accuracy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'Driver/company mismatch' USING ERRCODE='42501'; END IF;
  NEW.position_at := COALESCE(NEW.position_at,clock_timestamp());
  IF NEW.position_at > clock_timestamp()+interval '30 seconds' OR NEW.position_at < clock_timestamp()-interval '60 seconds' THEN
    RAISE EXCEPTION 'GPS fix is stale'; END IF;
  IF TG_OP='UPDATE' AND OLD.position_at > NEW.position_at THEN RETURN NULL; END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER guard_location BEFORE INSERT OR UPDATE ON public.driver_locations FOR EACH ROW EXECUTE FUNCTION private.guard_location();

CREATE UNIQUE INDEX one_active_ride_per_driver ON public.taxi_requests(driver_id) WHERE status IN ('accepted','arrived','in_progress');
CREATE UNIQUE INDEX one_active_ride_per_customer ON public.taxi_requests(customer_id) WHERE status IN ('pending','accepted','arrived','in_progress');
CREATE INDEX IF NOT EXISTS pending_requests_company_time ON public.taxi_requests(company_id,created_at) WHERE status='pending';

CREATE OR REPLACE FUNCTION private.guard_driver() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF NOT (public.is_super_admin() OR public.is_company_admin(OLD.company_id)) AND
    (to_jsonb(NEW)-ARRAY['is_online','status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['is_online','status','updated_at']) THEN
    RAISE EXCEPTION 'Driver administrative fields are protected' USING ERRCODE='42501'; END IF;
  NEW.status := CASE WHEN EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=NEW.id AND status IN ('accepted','arrived','in_progress'))
    THEN 'busy'::public.driver_status WHEN NEW.is_online THEN 'available'::public.driver_status ELSE 'offline'::public.driver_status END;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_driver BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_driver();

CREATE OR REPLACE FUNCTION private.guard_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
END $$;
CREATE TRIGGER guard_request BEFORE UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_request();

CREATE OR REPLACE FUNCTION public.create_trip_on_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.trips(request_id,company_id,driver_id,customer_id,distance_km,duration_min,total_amount,payment_method,started_at,ended_at)
    VALUES(NEW.id,NEW.company_id,NEW.driver_id,NEW.customer_id,NEW.estimated_distance_km,
      greatest(0,round(extract(epoch FROM (NEW.completed_at-NEW.started_at))/60,1)),NEW.final_price,NEW.payment_method,NEW.started_at,NEW.completed_at)
    ON CONFLICT(request_id) DO NOTHING;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.driver_id IS NOT NULL THEN
    UPDATE public.drivers SET status=CASE WHEN NEW.status IN ('accepted','arrived','in_progress') THEN 'busy'::public.driver_status
      WHEN is_online THEN 'available'::public.driver_status ELSE 'offline'::public.driver_status END WHERE id=NEW.driver_id;
  END IF;
  RETURN NEW;
END $$;
DROP POLICY IF EXISTS trips_insert_driver ON public.trips;
REVOKE INSERT,UPDATE,DELETE ON public.trips FROM anon,authenticated;

DROP POLICY IF EXISTS ratings_insert_customer ON public.ratings;
CREATE POLICY ratings_insert_customer ON public.ratings FOR INSERT TO authenticated WITH CHECK(
 customer_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.taxi_requests r WHERE r.id=request_id AND r.customer_id=ratings.customer_id
 AND r.driver_id=ratings.driver_id AND r.company_id=ratings.company_id AND r.status='completed'));

-- Server-generated price quotes, valid for two minutes; one quote can create only one ride.
CREATE TABLE public.ride_quotes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid NOT NULL REFERENCES public.profiles(id),
 company_id uuid NOT NULL REFERENCES public.companies(id), vehicle_type_id uuid NOT NULL REFERENCES public.vehicle_types(id),
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '2 minutes',
 request_id uuid UNIQUE REFERENCES public.taxi_requests(id)
);
ALTER TABLE public.ride_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_quotes FROM anon,authenticated;
GRANT SELECT ON public.ride_quotes TO authenticated;
GRANT ALL ON public.ride_quotes TO service_role;
CREATE POLICY quote_owner ON public.ride_quotes FOR SELECT TO authenticated USING(customer_id=(SELECT auth.uid()));
CREATE INDEX ride_quotes_customer_time ON public.ride_quotes(customer_id,created_at);

CREATE OR REPLACE FUNCTION public.create_taxi_request(p_quote_id uuid,p_request_id uuid,p_payment_method public.payment_method DEFAULT 'cash')
RETURNS public.taxi_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.create_taxi_request(uuid,uuid,public.payment_method) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_taxi_request(uuid,uuid,public.payment_method) TO authenticated;
-- Existing browser inserts must move to the validated quote RPC in the supplied frontend.
-- Final removal of legacy browser inserts is in deployment/quote-cutover.sql.
-- Run it immediately after publishing the included frontend.

-- Expire pending searches only. A long trip is never silently cancelled by age.
CREATE OR REPLACE FUNCTION public.expire_stale_requests() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 WITH expired AS(
  UPDATE public.taxi_requests SET status='cancelled',cancelled_at=now(),cancelled_by='system',cancel_reason='no_driver'
  WHERE status='pending' AND created_at<now()-interval '2 minutes' RETURNING id,customer_id,company_id
 ) INSERT INTO public.notifications(user_id,company_id,type,title,message,data,is_read)
 SELECT customer_id,company_id,'no_driver','Няма наличен шофьор','Опитайте отново след малко.',
 jsonb_build_object('request_id',id,'status','cancelled','reason','no_driver'),false FROM expired;
END $$;
CREATE OR REPLACE FUNCTION public.sweep_stuck_requests(max_age_minutes integer DEFAULT 30) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
 PERFORM public.expire_stale_requests();
 UPDATE public.drivers d SET is_online=false,status=CASE WHEN EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=d.id AND status IN ('accepted','arrived','in_progress'))
 THEN 'busy'::public.driver_status ELSE 'offline'::public.driver_status END
 WHERE is_online AND NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=d.id AND updated_at>now()-interval '90 seconds');
 GET DIAGNOSTICS n=ROW_COUNT;
 DELETE FROM public.ride_quotes WHERE expires_at<now()-interval '1 day';
 RETURN n;
END $$;
-- Replace the two competing schedulers with one transactional database job.
DO $$ DECLARE j record; BEGIN
 FOR j IN SELECT jobid FROM cron.job WHERE command LIKE '%sweep_stuck_requests%' OR command LIKE '%expire-stale-requests%'
 LOOP PERFORM cron.unschedule(j.jobid); END LOOP;
END $$;
SELECT cron.schedule('leski-maintenance','* * * * *','SELECT public.sweep_stuck_requests();');

-- Internal functions and maintenance are not anonymous RPC endpoints.
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS sig,p.prorettype='trigger'::regtype AS is_trigger
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') LOOP
  EXECUTE format('ALTER FUNCTION %s SET search_path TO public, pg_temp',f.sig);
  IF f.is_trigger THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.sig); END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.sweep_stuck_requests(integer),public.expire_stale_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stuck_requests(integer),public.expire_stale_requests() TO service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC,anon,authenticated;
-- PostGIS reference data remain readable, never client-writable.
-- spatial_ref_sys is owned by supabase_admin; postgres lacks grant option.
-- Owner-level remediation is tracked in deployment/README.md.
NOTIFY pgrst,'reload schema';
