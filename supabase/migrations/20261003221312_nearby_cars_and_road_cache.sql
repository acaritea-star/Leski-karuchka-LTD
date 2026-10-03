-- Private, bounded preview API; existing location RLS remains unchanged.
CREATE TABLE private.nearby_read_limits(user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE, last_read timestamptz NOT NULL);
ALTER TABLE private.nearby_read_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.nearby_read_limits FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.nearby_cars(p_lat double precision,p_lng double precision,p_type uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 ORDER BY l.geo <-> public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography LIMIT 12
 ) cars;
 RETURN jsonb_build_object('cars',result,'sampled_at',clock_timestamp());
END $$;
REVOKE ALL ON FUNCTION private.nearby_cars(double precision,double precision,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.nearby_cars(double precision,double precision,uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.nearby_cars(p_lat double precision,p_lng double precision,p_type uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.nearby_cars(p_lat,p_lng,p_type); $$;
REVOKE ALL ON FUNCTION public.nearby_cars(double precision,double precision,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nearby_cars(double precision,double precision,uuid) TO authenticated;

-- Public road geometry only. Shared week-long cache and a lease prevent stampedes.
CREATE TABLE private.road_tiles(key text PRIMARY KEY,roads jsonb,expires_at timestamptz NOT NULL DEFAULT '-infinity',lease_until timestamptz NOT NULL DEFAULT '-infinity');
ALTER TABLE private.road_tiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.road_tiles FROM PUBLIC,anon,authenticated;
CREATE TABLE private.road_fetch_budget(day date PRIMARY KEY,requests integer NOT NULL);
ALTER TABLE private.road_fetch_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.road_fetch_budget FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.road_tile_cache(p_key text,p_roads jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tile private.road_tiles; count integer;
BEGIN
 IF p_key IS NULL OR p_key !~ '^[0-9]{4}:[0-9]{4}$' THEN RAISE EXCEPTION 'Invalid tile'; END IF;
 INSERT INTO private.road_tiles(key) VALUES(p_key) ON CONFLICT DO NOTHING;
 SELECT * INTO tile FROM private.road_tiles WHERE key=p_key FOR UPDATE;
 IF p_roads IS NOT NULL THEN
  IF jsonb_typeof(p_roads)<>'array' OR octet_length(p_roads::text)>1500000 THEN RAISE EXCEPTION 'Invalid road data'; END IF;
  UPDATE private.road_tiles SET roads=p_roads,expires_at=clock_timestamp()+interval '7 days',lease_until='-infinity' WHERE key=p_key;
  RETURN jsonb_build_object('roads',p_roads,'fetch',false);
 END IF;
 IF tile.expires_at>clock_timestamp() THEN RETURN jsonb_build_object('roads',tile.roads,'fetch',false); END IF;
 IF tile.lease_until>clock_timestamp() THEN RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',false); END IF;
 INSERT INTO private.road_fetch_budget VALUES(current_date,1) ON CONFLICT(day) DO UPDATE SET requests=private.road_fetch_budget.requests+1 WHERE private.road_fetch_budget.requests<30 RETURNING requests INTO count;
 IF count IS NULL THEN RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',false); END IF;
 DELETE FROM private.road_fetch_budget WHERE day<current_date-7;
 UPDATE private.road_tiles SET lease_until=clock_timestamp()+interval '60 seconds' WHERE key=p_key;
 RETURN jsonb_build_object('roads',COALESCE(tile.roads,'[]'::jsonb),'fetch',true);
END $$;
REVOKE ALL ON FUNCTION private.road_tile_cache(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.road_tile_cache(text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.road_tile_cache(p_key text,p_roads jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.road_tile_cache(p_key,p_roads); $$;
REVOKE ALL ON FUNCTION public.road_tile_cache(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.road_tile_cache(text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
