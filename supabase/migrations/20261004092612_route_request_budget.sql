-- The app budget is below the operator's 150/day Google Cloud quota.
-- Only google-routes uses this RPC; GPS writes, geocoding and OSM do not.
CREATE TABLE private.route_budget_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 daily_limit integer NOT NULL DEFAULT 120 CHECK(daily_limit BETWEEN 1 AND 100000),
 quote_reserve integer NOT NULL DEFAULT 20 CHECK(quote_reserve>=0 AND quote_reserve<daily_limit),
 user_daily_limit integer NOT NULL DEFAULT 60 CHECK(user_daily_limit BETWEEN 1 AND daily_limit),
 ride_limit integer NOT NULL DEFAULT 10 CHECK(ride_limit BETWEEN 1 AND 1000)
);
INSERT INTO private.route_budget_settings(singleton) VALUES(true);
CREATE TABLE private.route_budget_usage (
 bucket text NOT NULL CHECK(bucket='global' OR bucket ~ '^(user|ride):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 budget_day date NOT NULL,
 hits integer NOT NULL DEFAULT 0 CHECK(hits>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(bucket,budget_day)
);
CREATE INDEX route_budget_cleanup ON private.route_budget_usage(budget_day,updated_at);
ALTER TABLE private.route_budget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.route_budget_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.route_budget_settings,private.route_budget_usage FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT SELECT ON private.route_budget_settings TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.route_budget_usage TO service_role;
CREATE POLICY route_settings_service_read ON private.route_budget_settings FOR SELECT TO service_role USING(true);
CREATE POLICY route_usage_service_only ON private.route_budget_usage FOR ALL TO service_role USING(true) WITH CHECK(true);

CREATE FUNCTION private.reserve_route_request(
 p_user_id uuid,p_request_id uuid,p_quote boolean,
 p_origin_lat double precision,p_origin_lng double precision,
 p_destination_lat double precision,p_destination_lng double precision,p_purpose text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 actor public.profiles; ride public.taxi_requests; driver_user uuid; driver_key uuid;
 cfg private.route_budget_settings;
 day_key date:=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date;
 until_reset integer; g integer; u integer; r integer:=0; mode text; has_ride boolean:=false;
 user_bucket text:='user:'||p_user_id::text; ride_bucket text;
BEGIN
 -- The caller is exclusively service_role. The Edge Function has already
 -- verified the bearer token with Auth; user-editable JWT metadata is unused.
 SELECT * INTO actor FROM public.profiles WHERE id=p_user_id AND is_active;
 IF NOT FOUND OR actor.role NOT IN ('CUSTOMER','DRIVER') THEN
  RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
 END IF;
 IF p_quote IS NULL OR NOT private.in_bulgaria(p_origin_lat,p_origin_lng)
  OR NOT private.in_bulgaria(p_destination_lat,p_destination_lng)
  OR (p_purpose IS NOT NULL AND p_purpose NOT IN ('pickup','destination','context')) THEN
  RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
 END IF;
 IF p_request_id IS NOT NULL THEN
  SELECT * INTO ride FROM public.taxi_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED'); END IF;
  has_ride:=true;
 ELSE
  -- Infer the active ride for older deployed clients as well, so omitting
  -- request_id cannot bypass the shared ride limit.
  IF actor.role='CUSTOMER' THEN
   SELECT * INTO ride FROM public.taxi_requests WHERE customer_id=p_user_id AND status IN ('pending','accepted','arrived','in_progress') LIMIT 1;
  ELSE
   SELECT id INTO driver_key FROM public.drivers WHERE user_id=p_user_id;
   SELECT * INTO ride FROM public.taxi_requests WHERE driver_id=driver_key AND status IN ('accepted','arrived','in_progress') LIMIT 1;
  END IF;
  has_ride:=FOUND;
 END IF;
 IF p_quote THEN
  IF actor.role<>'CUSTOMER' OR p_request_id IS NOT NULL OR p_purpose IS NOT NULL THEN
   RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
  END IF;
  IF has_ride THEN RETURN jsonb_build_object('allowed',false,'status',409,'code','ACTIVE_REQUEST_EXISTS'); END IF;
  mode:='quote';
 ELSIF has_ride THEN
  SELECT user_id INTO driver_user FROM public.drivers WHERE id=ride.driver_id;
  IF (ride.customer_id IS DISTINCT FROM p_user_id AND driver_user IS DISTINCT FROM p_user_id)
   OR ride.status NOT IN ('accepted','arrived','in_progress') THEN
   RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
  END IF;
  IF ride.pickup_latitude IS NULL OR ride.pickup_longitude IS NULL OR ride.destination_latitude IS NULL OR ride.destination_longitude IS NULL THEN
   RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
  END IF;
  mode:=p_purpose;
  IF mode IS NULL THEN
   mode:=CASE WHEN abs(p_origin_lat-ride.pickup_latitude)<0.000001 AND abs(p_origin_lng-ride.pickup_longitude)<0.000001
    AND abs(p_destination_lat-ride.destination_latitude)<0.000001 AND abs(p_destination_lng-ride.destination_longitude)<0.000001 THEN 'context'
    WHEN ride.status IN ('accepted','arrived') THEN 'pickup' ELSE 'destination' END;
  END IF;
  IF (mode='context' AND (abs(p_origin_lat-ride.pickup_latitude)>=0.000001 OR abs(p_origin_lng-ride.pickup_longitude)>=0.000001
    OR abs(p_destination_lat-ride.destination_latitude)>=0.000001 OR abs(p_destination_lng-ride.destination_longitude)>=0.000001))
   OR (mode='pickup' AND (ride.status NOT IN ('accepted','arrived') OR abs(p_destination_lat-ride.pickup_latitude)>=0.000001 OR abs(p_destination_lng-ride.pickup_longitude)>=0.000001))
   OR (mode='destination' AND (ride.status<>'in_progress' OR abs(p_destination_lat-ride.destination_latitude)>=0.000001 OR abs(p_destination_lng-ride.destination_longitude)>=0.000001)) THEN
   RETURN jsonb_build_object('allowed',false,'status',400,'code','INVALID_ROUTE_CONTEXT');
  END IF;
  ride_bucket:='ride:'||ride.id::text;
 ELSIF actor.role='DRIVER' OR p_request_id IS NOT NULL OR p_purpose IS NOT NULL THEN
  RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED');
 ELSE mode:='preview';
 END IF;

 SELECT * INTO STRICT cfg FROM private.route_budget_settings WHERE singleton;
 until_reset:=greatest(1,ceil(extract(epoch FROM ((day_key+1)::timestamp AT TIME ZONE 'America/Los_Angeles')-clock_timestamp()))::integer);
 -- One short transaction serializes the small shared budget. Google is called
 -- only after this transaction commits, never while an advisory lock is held.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('leski-google-routes-budget',0));
 DELETE FROM private.route_budget_usage b WHERE b.budget_day<day_key-7
  OR (b.budget_day='infinity'::date AND b.updated_at<clock_timestamp()-interval '7 days'
   AND NOT EXISTS(SELECT 1 FROM public.taxi_requests q WHERE q.id=CASE WHEN b.bucket LIKE 'ride:%' THEN substring(b.bucket FROM 6)::uuid END AND q.status IN ('accepted','arrived','in_progress')));
 INSERT INTO private.route_budget_usage(bucket,budget_day) VALUES('global',day_key),(user_bucket,day_key) ON CONFLICT DO NOTHING;
 IF ride_bucket IS NOT NULL THEN INSERT INTO private.route_budget_usage(bucket,budget_day) VALUES(ride_bucket,'infinity') ON CONFLICT DO NOTHING; END IF;
 SELECT hits INTO g FROM private.route_budget_usage WHERE bucket='global' AND budget_day=day_key;
 SELECT hits INTO u FROM private.route_budget_usage WHERE bucket=user_bucket AND budget_day=day_key;
 IF ride_bucket IS NOT NULL THEN SELECT hits INTO r FROM private.route_budget_usage WHERE bucket=ride_bucket AND budget_day='infinity'; END IF;
 IF ride_bucket IS NOT NULL AND r>=cfg.ride_limit THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_RIDE_LIMIT','retry_after_sec',90000);
 END IF;
 IF u>=cfg.user_daily_limit THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_USER_LIMIT','retry_after_sec',until_reset);
 END IF;
 IF g>=cfg.daily_limit OR (mode<>'quote' AND g>=cfg.daily_limit-cfg.quote_reserve) THEN
  RETURN jsonb_build_object('allowed',false,'status',429,'code','ROUTE_DAILY_LIMIT','retry_after_sec',until_reset);
 END IF;
 UPDATE private.route_budget_usage SET hits=hits+1,updated_at=clock_timestamp()
  WHERE (budget_day=day_key AND bucket IN ('global',user_bucket)) OR (budget_day='infinity' AND bucket=ride_bucket);
 RETURN jsonb_build_object('allowed',true,'request_id',CASE WHEN has_ride AND NOT p_quote THEN ride.id ELSE NULL END,'purpose',mode);
END $$;
REVOKE ALL ON FUNCTION private.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text) TO service_role;
CREATE FUNCTION public.reserve_route_request(
 p_user_id uuid,p_request_id uuid,p_quote boolean,p_origin_lat double precision,p_origin_lng double precision,
 p_destination_lat double precision,p_destination_lng double precision,p_purpose text
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.reserve_route_request(p_user_id,p_request_id,p_quote,p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_purpose);
$$;
REVOKE ALL ON FUNCTION public.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_route_request(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text) TO service_role;
