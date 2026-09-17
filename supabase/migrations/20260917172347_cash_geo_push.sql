-- One eligibility rule for the request feed, acceptance and push recipients.
CREATE OR REPLACE FUNCTION private.eligible_drivers(
  p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL
) RETURNS TABLE(driver_id uuid, user_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.user_id
  FROM public.drivers d
  JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
  JOIN public.companies c ON c.id=d.company_id AND c.is_active
  JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
  JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
  JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=d.company_id
  WHERE d.company_id=p_company AND v.vehicle_type_id=p_type
    AND (p_user IS NULL OR d.user_id=p_user) AND d.is_online AND d.is_verified
    AND l.updated_at > now()-interval '45 seconds'
    AND l.position_at > now()-interval '45 seconds'
    AND l.position_at <= now()+interval '30 seconds'
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND c.dispatch_radius_km > 0
    AND public.st_dwithin(l.geo,
      public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
      c.dispatch_radius_km::double precision*1000)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r
      WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$$;
REVOKE ALL ON FUNCTION private.eligible_drivers(uuid,uuid,double precision,double precision,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.can_receive_request(
  p_company uuid, p_type uuid, p_lat double precision, p_lng double precision
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM private.eligible_drivers(p_company,p_type,p_lat,p_lng,auth.uid()));
$$;
REVOKE ALL ON FUNCTION private.can_receive_request(uuid,uuid,double precision,double precision) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_receive_request(uuid,uuid,double precision,double precision) TO authenticated;

ALTER POLICY taxi_requests_select_driver ON public.taxi_requests USING (
  public.is_driver(driver_id) OR public.is_company_admin(company_id) OR public.is_super_admin()
  OR (status='pending' AND private.can_receive_request(company_id,vehicle_type_id,pickup_latitude,pickup_longitude)));
ALTER POLICY taxi_requests_update_driver ON public.taxi_requests USING (
  public.is_driver(driver_id)
  OR (status='pending' AND private.can_receive_request(company_id,vehicle_type_id,pickup_latitude,pickup_longitude)));

CREATE OR REPLACE FUNCTION private.guard_request_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
  IF OLD.status='pending' AND NEW.status='accepted'
    AND NOT private.can_receive_request(OLD.company_id,OLD.vehicle_type_id,OLD.pickup_latitude,OLD.pickup_longitude) THEN
    RAISE EXCEPTION 'Driver is outside the dispatch area or unavailable' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_request_dispatch() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_request_dispatch BEFORE UPDATE ON public.taxi_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_request_dispatch();

CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.user_id FROM public.taxi_requests r
  CROSS JOIN LATERAL private.eligible_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude) d
  WHERE r.id=p_request_id AND r.status='pending' AND r.created_at>now()-interval '2 minutes';
$$;
REVOKE ALL ON FUNCTION public.request_push_recipients(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_push_recipients(uuid) TO service_role;

-- New orders are cash only; historical payment records remain intact.
CREATE OR REPLACE FUNCTION private.guard_cash_request() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.payment_method IS DISTINCT FROM 'cash'::public.payment_method THEN
    RAISE EXCEPTION 'Only cash payment is available';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_cash_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_cash_request BEFORE INSERT ON public.taxi_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_cash_request();
-- The current frontend already orders through the validated quote RPC.
DROP POLICY IF EXISTS taxi_requests_insert_customer ON public.taxi_requests;
REVOKE INSERT ON public.taxi_requests FROM anon,authenticated;

-- Keep ambiguous legacy subscriptions for audit, but never deliver to them.
ALTER TABLE public.push_subscriptions ADD COLUMN is_active boolean NOT NULL DEFAULT true;
UPDATE public.push_subscriptions SET is_active=false WHERE endpoint IN (
  SELECT endpoint FROM public.push_subscriptions GROUP BY endpoint HAVING count(*)>1);
CREATE UNIQUE INDEX push_one_active_owner ON public.push_subscriptions(endpoint) WHERE is_active;

CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE owner_id uuid := auth.uid();
BEGIN
  IF owner_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_id AND is_active) THEN
    RAISE EXCEPTION 'Active account required' USING ERRCODE='42501';
  END IF;
  IF p_endpoint IS NULL OR length(p_endpoint)>2048 OR p_endpoint NOT LIKE 'https://%'
    OR p_p256dh IS NULL OR length(p_p256dh) NOT BETWEEN 20 AND 256
    OR p_auth IS NULL OR length(p_auth) NOT BETWEEN 16 AND 256 THEN
    RAISE EXCEPTION 'Invalid push subscription';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_endpoint,0));
  UPDATE public.push_subscriptions SET is_active=false
    WHERE endpoint=p_endpoint AND user_id<>owner_id AND is_active;
  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth,user_agent,is_active,updated_at)
  VALUES(owner_id,p_endpoint,p_p256dh,p_auth,left(p_user_agent,1024),true,now())
  ON CONFLICT(user_id,endpoint) DO UPDATE SET p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,
    user_agent=EXCLUDED.user_agent,is_active=true,updated_at=now();
END $$;
REVOKE ALL ON FUNCTION public.register_push_subscription(text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_push_subscription(text,text,text,text) TO authenticated;
REVOKE INSERT,UPDATE ON public.push_subscriptions FROM anon,authenticated;
NOTIFY pgrst,'reload schema';
