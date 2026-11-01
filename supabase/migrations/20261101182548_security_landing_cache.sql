CREATE TABLE private.landing_stats_cache (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 payload jsonb, refreshed_at timestamptz NOT NULL DEFAULT '-infinity'
);
ALTER TABLE private.landing_stats_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.landing_stats_cache FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.landing_stats_cache(singleton) VALUES(true);

-- Shared cache: at most one aggregate refresh/minute across Edge instances.
CREATE FUNCTION private.read_landing_stats() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE cached private.landing_stats_cache; result jsonb;
BEGIN
 SELECT * INTO STRICT cached FROM private.landing_stats_cache WHERE singleton;
 IF cached.payload IS NOT NULL AND cached.refreshed_at>clock_timestamp()-interval '60 seconds' THEN RETURN cached.payload; END IF;
 SELECT * INTO cached FROM private.landing_stats_cache WHERE singleton FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN
  SELECT payload INTO result FROM private.landing_stats_cache WHERE singleton;
  IF result IS NULL THEN RAISE EXCEPTION 'Statistics temporarily unavailable' USING ERRCODE='55P03'; END IF;
  RETURN result;
 END IF;
 IF cached.payload IS NOT NULL AND cached.refreshed_at>clock_timestamp()-interval '60 seconds' THEN RETURN cached.payload; END IF;
 SELECT jsonb_build_object(
  'completed_trips',(SELECT count(*) FROM public.trips),
  'avg_rating',(SELECT coalesce(round(avg(rating),1),0) FROM public.drivers WHERE rating BETWEEN 0 AND 5)
 ) INTO result;
 UPDATE private.landing_stats_cache SET payload=result,refreshed_at=clock_timestamp() WHERE singleton;
 RETURN result;
END $body$;
CREATE FUNCTION public.read_landing_stats() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.read_landing_stats() $$;
REVOKE ALL ON FUNCTION private.read_landing_stats(),public.read_landing_stats() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.read_landing_stats(),public.read_landing_stats() TO service_role;
