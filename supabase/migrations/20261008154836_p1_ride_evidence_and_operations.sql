-- GPS observations are evidence of device reports, never proof of payment or a taximeter.
-- Additive: no historical rides, prices or financial entries are rewritten.
-- Register the exact public sources before the new frontend asks for acceptance.
UPDATE private.legal_versions SET is_current=false WHERE is_current;
INSERT INTO private.legal_versions(terms_version,privacy_version,source_digest)
VALUES('2026-10-08-draft.3','2026-10-08.1','52861bb106fd986bdd8aa9ac52bb59ee44c0fd3947d32fadd4073d76cba98190');
CREATE OR REPLACE FUNCTION private.accept_legal_versions(p_terms text,p_privacy text,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT v.source_digest INTO digest FROM private.legal_versions v
 WHERE v.terms_version=p_terms AND v.privacy_version=p_privacy AND (v.is_current OR (
  -- Cached clients may accept only the text they actually saw during cutover.
  -- This never counts as acceptance of the new GPS-history disclosure.
  v.terms_version='2026-10-03-draft.2' AND v.privacy_version='2026-10-04.2'
  AND EXISTS(SELECT 1 FROM private.legal_versions current_version WHERE current_version.is_current
   AND current_version.terms_version='2026-10-08-draft.3' AND current_version.privacy_version='2026-10-08.1'
   AND current_version.created_at>clock_timestamp()-interval '7 days')
 ));
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
END $$;

CREATE TABLE public.ride_evidence (
 request_id uuid PRIMARY KEY REFERENCES public.taxi_requests(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 customer_id uuid NOT NULL REFERENCES public.profiles(id),
 driver_id uuid NOT NULL REFERENCES public.drivers(id),
 first_observed_at timestamptz,
 last_observed_at timestamptz,
 samples integer NOT NULL DEFAULT 0,
 good_samples integer NOT NULL DEFAULT 0,
 approach_meters double precision NOT NULL DEFAULT 0,
 trip_meters double precision NOT NULL DEFAULT 0,
 observed_seconds double precision NOT NULL DEFAULT 0,
 stationary_seconds double precision NOT NULL DEFAULT 0,
 flags text[] NOT NULL DEFAULT '{}',
 customer_confirmed_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ride_evidence_company_updated ON public.ride_evidence(company_id,updated_at DESC);
ALTER TABLE public.ride_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ride_evidence FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.ride_evidence TO authenticated;
CREATE POLICY evidence_read ON public.ride_evidence FOR SELECT TO authenticated USING (
 public.is_super_admin() OR public.is_company_admin(company_id) OR public.is_driver(driver_id)
 OR (customer_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND is_active))
);

CREATE TABLE private.ride_location_samples (
 request_id uuid NOT NULL REFERENCES public.ride_evidence(request_id) ON DELETE CASCADE,
 position_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 phase text NOT NULL CHECK(phase IN ('accepted','arrived','in_progress')),
 latitude double precision NOT NULL,
 longitude double precision NOT NULL,
 accuracy double precision,
 quality text NOT NULL CHECK(quality IN ('good','poor_accuracy','clock_skew','gps_jump','gps_gap')),
 PRIMARY KEY(request_id,position_at)
);
CREATE INDEX ride_samples_retention ON private.ride_location_samples(received_at);
ALTER TABLE private.ride_location_samples ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.ride_location_samples FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.observed_distance(a double precision,b double precision,c double precision,d double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT 12742000 * asin(sqrt(least(1.0,greatest(0.0,
 sin(radians(c-a)/2)^2+cos(radians(a))*cos(radians(c))*sin(radians(d-b)/2)^2))));
$$;
REVOKE ALL ON FUNCTION private.observed_distance(double precision,double precision,double precision,double precision) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.observe_ride_location() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.taxi_requests; e public.ride_evidence; prev private.ride_location_samples;
 quality text:='good'; dt double precision:=0; meters double precision:=0; movement double precision:=0;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.drivers d JOIN public.legal_acceptances a ON a.user_id=d.user_id
  WHERE d.id=NEW.driver_id AND a.privacy_version='2026-10-08.1') THEN RETURN NEW; END IF;
 -- Indexed active-driver lookup; reuse incoming GPS, with no extra network request.
 SELECT * INTO r FROM public.taxi_requests WHERE driver_id=NEW.driver_id AND status IN ('accepted','arrived','in_progress') LIMIT 1;
 IF NOT FOUND THEN RETURN NEW; END IF;
 INSERT INTO public.ride_evidence(request_id,company_id,customer_id,driver_id)
 VALUES(r.id,r.company_id,r.customer_id,r.driver_id) ON CONFLICT DO NOTHING;
 SELECT * INTO e FROM public.ride_evidence WHERE request_id=r.id FOR UPDATE;
 SELECT * INTO prev FROM private.ride_location_samples WHERE request_id=r.id ORDER BY position_at DESC LIMIT 1;
 IF FOUND THEN
  dt:=extract(epoch FROM NEW.position_at-prev.position_at);
  IF dt<=0 OR (dt<10 AND prev.phase=r.status::text) THEN RETURN NEW; END IF;
 END IF;
 IF NEW.accuracy IS NULL OR NEW.accuracy>65 THEN quality:='poor_accuracy';
 ELSIF NEW.position_at>clock_timestamp()+interval '5 seconds' THEN quality:='clock_skew';
 ELSIF prev.request_id IS NOT NULL THEN
  meters:=private.observed_distance(prev.latitude,prev.longitude,NEW.latitude,NEW.longitude);
  IF dt>60 THEN quality:='gps_gap';
  ELSIF prev.quality IN ('good','gps_gap') AND meters>greatest(120,coalesce(prev.accuracy,0)+NEW.accuracy) AND meters/dt>60 THEN quality:='gps_jump';
  ELSIF prev.quality IN ('good','gps_gap') AND prev.phase=r.status::text THEN
   -- Accuracy jitter is not billable distance. Segment distance is a lower-resolution observation.
   IF meters>greatest(12,(coalesce(prev.accuracy,0)+NEW.accuracy)/2) THEN movement:=meters; END IF;
  END IF;
 END IF;
 INSERT INTO private.ride_location_samples(request_id,position_at,phase,latitude,longitude,accuracy,quality)
 VALUES(r.id,NEW.position_at,r.status::text,NEW.latitude,NEW.longitude,NEW.accuracy,quality);
 UPDATE public.ride_evidence SET
  first_observed_at=coalesce(first_observed_at,NEW.position_at),last_observed_at=NEW.position_at,
  samples=samples+1,good_samples=good_samples+CASE WHEN quality IN ('good','gps_gap') THEN 1 ELSE 0 END,
  approach_meters=approach_meters+CASE WHEN r.status IN ('accepted','arrived') THEN movement ELSE 0 END,
  trip_meters=trip_meters+CASE WHEN r.status='in_progress' THEN movement ELSE 0 END,
  observed_seconds=observed_seconds+CASE WHEN r.status='in_progress' AND prev.phase='in_progress' AND quality='good' AND prev.quality IN ('good','gps_gap') THEN dt ELSE 0 END,
  stationary_seconds=stationary_seconds+CASE WHEN r.status='in_progress' AND prev.phase='in_progress' AND quality='good' AND prev.quality IN ('good','gps_gap') AND movement=0 THEN dt ELSE 0 END,
  flags=ARRAY(SELECT DISTINCT f FROM unnest(flags||CASE WHEN quality='good' THEN '{}'::text[] ELSE ARRAY[quality] END) f ORDER BY f),
  updated_at=clock_timestamp() WHERE request_id=r.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.observe_ride_location() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER observe_active_ride_location AFTER INSERT OR UPDATE ON public.driver_locations
 FOR EACH ROW EXECUTE FUNCTION private.observe_ride_location();

CREATE FUNCTION private.observe_ride_transition() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc public.driver_locations; issues text[]:='{}'; target_lat double precision; target_lng double precision;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.driver_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.drivers d JOIN public.legal_acceptances a ON a.user_id=d.user_id
  WHERE d.id=NEW.driver_id AND a.privacy_version='2026-10-08.1') THEN RETURN NEW; END IF;
 INSERT INTO public.ride_evidence(request_id,company_id,customer_id,driver_id)
 VALUES(NEW.id,NEW.company_id,NEW.customer_id,NEW.driver_id) ON CONFLICT DO NOTHING;
 IF NEW.status IN ('arrived','in_progress','completed') THEN
  SELECT * INTO loc FROM public.driver_locations WHERE driver_id=NEW.driver_id;
  IF NOT FOUND OR loc.position_at<clock_timestamp()-interval '45 seconds' OR loc.position_at>clock_timestamp()+interval '5 seconds'
   OR loc.accuracy IS NULL OR loc.accuracy>65 THEN
   issues:=array_append(issues,NEW.status::text||'_gps_unavailable');
  ELSE
   target_lat:=CASE WHEN NEW.status='completed' THEN NEW.destination_latitude ELSE NEW.pickup_latitude END;
   target_lng:=CASE WHEN NEW.status='completed' THEN NEW.destination_longitude ELSE NEW.pickup_longitude END;
   IF private.observed_distance(loc.latitude,loc.longitude,target_lat,target_lng)>greatest(200,loc.accuracy*2) THEN
    issues:=array_append(issues,NEW.status::text||'_far_from_stop');
   END IF;
  END IF;
 END IF;
 IF NEW.status IN ('completed','cancelled') THEN
  IF NEW.status='completed' AND NEW.estimated_distance_km>1 AND
   (NEW.started_at IS NULL OR extract(epoch FROM coalesce(NEW.completed_at,clock_timestamp())-NEW.started_at)<NEW.estimated_distance_km*1000/60)
   THEN issues:=array_append(issues,'implausible_duration'); END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ride_evidence WHERE request_id=NEW.id AND good_samples>=2)
   THEN issues:=array_append(issues,'insufficient_gps'); END IF;
 END IF;
 UPDATE public.ride_evidence SET flags=ARRAY(SELECT DISTINCT f FROM unnest(flags||issues) f ORDER BY f),updated_at=clock_timestamp() WHERE request_id=NEW.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.observe_ride_transition() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER observe_ride_transition AFTER UPDATE OF status ON public.taxi_requests
 FOR EACH ROW EXECUTE FUNCTION private.observe_ride_transition();

CREATE FUNCTION public.confirm_ride_start(p_request_id uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.taxi_requests; confirmed timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND is_active) THEN RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id AND customer_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Ride not found' USING ERRCODE='42501'; END IF;
 SELECT customer_confirmed_at INTO confirmed FROM public.ride_evidence WHERE request_id=r.id;
 IF confirmed IS NOT NULL THEN RETURN confirmed; END IF;
 IF r.status<>'in_progress' OR r.driver_id IS NULL THEN RAISE EXCEPTION 'Ride has not started'; END IF;
 INSERT INTO public.ride_evidence(request_id,company_id,customer_id,driver_id,customer_confirmed_at)
 VALUES(r.id,r.company_id,r.customer_id,r.driver_id,clock_timestamp()) ON CONFLICT(request_id)
 DO UPDATE SET customer_confirmed_at=coalesce(public.ride_evidence.customer_confirmed_at,EXCLUDED.customer_confirmed_at),updated_at=clock_timestamp()
 RETURNING customer_confirmed_at INTO confirmed;
 RETURN confirmed;
END $$;
REVOKE ALL ON FUNCTION public.confirm_ride_start(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.confirm_ride_start(uuid) TO authenticated;

-- Bounded trace export. Authorize before reading the private GPS archive.
CREATE FUNCTION public.ride_observations(p_request_id uuid,p_after timestamptz DEFAULT '-infinity',p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.ride_evidence;
BEGIN
 SELECT * INTO e FROM public.ride_evidence WHERE request_id=p_request_id;
 IF NOT FOUND OR NOT (public.is_super_admin() OR public.is_company_admin(e.company_id) OR public.is_driver(e.driver_id)
  OR (EXISTS(SELECT 1 FROM public.profiles WHERE id=(SELECT auth.uid()) AND is_active) AND e.customer_id=auth.uid())) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF p_after IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid page'; END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM (SELECT position_at,phase,latitude,longitude,accuracy,quality
  FROM private.ride_location_samples WHERE request_id=p_request_id AND position_at>p_after AND received_at>=clock_timestamp()-interval '7 days'
  ORDER BY position_at LIMIT p_limit) s),'[]');
END $$;
REVOKE ALL ON FUNCTION public.ride_observations(uuid,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ride_observations(uuid,timestamptz,integer) TO authenticated;

CREATE FUNCTION private.prune_ride_observations() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM private.ride_location_samples WHERE (request_id,position_at) IN
 (SELECT request_id,position_at FROM private.ride_location_samples WHERE received_at<clock_timestamp()-interval '7 days' ORDER BY received_at LIMIT 20000);
$$;
REVOKE ALL ON FUNCTION private.prune_ride_observations() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('prune-ride-observations','*/10 * * * *','SELECT private.prune_ride_observations()');

-- One compact diagnostic batch/user/minute, kept seven days. No URLs, messages,
-- positions or device fingerprints. Browser timings are untrusted diagnostics.
CREATE TABLE private.operation_metric_batches (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), rows jsonb NOT NULL
);
CREATE INDEX metric_user_time ON private.operation_metric_batches(user_id,received_at DESC);
CREATE INDEX metric_company_time ON private.operation_metric_batches(company_id,received_at DESC);
CREATE INDEX metric_retention ON private.operation_metric_batches(received_at);
ALTER TABLE private.operation_metric_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.operation_metric_batches FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.record_operation_metrics(p_id uuid,p_rows jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); cid uuid; row jsonb;
BEGIN
 SELECT company_id INTO cid FROM public.profiles WHERE id=uid AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active account required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 48
  OR octet_length(p_rows::text)>16000 THEN RAISE EXCEPTION 'Invalid batch'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF jsonb_typeof(row)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(row))<>5
   OR coalesce(row->>'name','') NOT IN ('driver.read','driver.online','gps.read','gps.write','ride.accept','ride.create','ride.transition','ride.cancel','ride.reconcile','tracking.read','dashboard.read','route.read')
   OR coalesce(row->>'outcome','') NOT IN ('ok','error','timeout','aborted')
   OR coalesce(row->>'count','') !~ '^[0-9]{1,4}$' OR (row->>'count')::int NOT BETWEEN 1 AND 1000
   OR coalesce(row->>'totalMs','') !~ '^[0-9]{1,9}$' OR (row->>'totalMs')::bigint>120000000
   OR coalesce(row->>'maxMs','') !~ '^[0-9]{1,6}$' OR (row->>'maxMs')::int>120000
   THEN RAISE EXCEPTION 'Invalid metric'; END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended('metrics:'||uid::text,0));
 IF EXISTS(SELECT 1 FROM private.operation_metric_batches WHERE id=p_id AND user_id=uid) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM private.operation_metric_batches WHERE user_id=uid AND received_at>clock_timestamp()-interval '60 seconds') THEN RETURN false; END IF;
 INSERT INTO private.operation_metric_batches(id,user_id,company_id,rows) VALUES(p_id,uid,cid,p_rows);
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.record_operation_metrics(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_operation_metrics(uuid,jsonb) TO authenticated;


CREATE TABLE private.company_route_usage (
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 budget_day date NOT NULL, quoted boolean NOT NULL, reserved integer NOT NULL DEFAULT 0, denied integer NOT NULL DEFAULT 0,
 PRIMARY KEY(company_id,budget_day,quoted)
);
ALTER TABLE private.company_route_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.company_route_usage FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.reserve_route_request_v2(
 p_user_id uuid,p_request_id uuid,p_quote boolean,p_origin_lat double precision,p_origin_lng double precision,
 p_destination_lat double precision,p_destination_lng double precision,p_purpose text,p_company_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; cid uuid:=p_company_id; day_key date:=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
 IF p_quote THEN
  IF cid IS NULL OR NOT EXISTS(SELECT 1 FROM public.companies WHERE id=cid AND is_active) THEN RETURN jsonb_build_object('allowed',false,'status',403,'code','ROUTE_ACCESS_DENIED'); END IF;
 ELSIF p_request_id IS NOT NULL THEN SELECT company_id INTO cid FROM public.taxi_requests WHERE id=p_request_id;
 END IF;
 result:=private.reserve_route_request(p_user_id,p_request_id,p_quote,p_origin_lat,p_origin_lng,p_destination_lat,p_destination_lng,p_purpose);
 IF cid IS NOT NULL AND (result->>'allowed'='true' OR result->>'status'='429') THEN
  INSERT INTO private.company_route_usage(company_id,budget_day,quoted,reserved,denied)
   VALUES(cid,day_key,p_quote,CASE WHEN result->>'allowed'='true' THEN 1 ELSE 0 END,CASE WHEN result->>'allowed'='false' THEN 1 ELSE 0 END)
   ON CONFLICT(company_id,budget_day,quoted) DO UPDATE SET reserved=private.company_route_usage.reserved+EXCLUDED.reserved,denied=private.company_route_usage.denied+EXCLUDED.denied;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_route_request_v2(uuid,uuid,boolean,double precision,double precision,double precision,double precision,text,uuid) TO service_role;

CREATE FUNCTION public.operational_health(p_company_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; budget jsonb; metrics jsonb; stale integer; flagged integer; queue_age numeric;
BEGIN
 IF p_company_id IS NULL OR NOT(public.is_super_admin() OR public.is_company_admin(p_company_id)) THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT count(*) INTO stale FROM public.drivers d LEFT JOIN public.driver_locations l ON l.driver_id=d.id
  WHERE d.company_id=p_company_id AND d.is_online AND (l.position_at IS NULL OR l.position_at<clock_timestamp()-interval '45 seconds');
 SELECT count(*) INTO flagged FROM public.ride_evidence e WHERE e.company_id=p_company_id
  AND e.updated_at>clock_timestamp()-interval '24 hours' AND cardinality(e.flags)>0;
 SELECT extract(epoch FROM clock_timestamp()-min(o.created_at)) INTO queue_age FROM private.push_outbox o
  JOIN public.taxi_requests r ON r.id=o.request_id WHERE r.company_id=p_company_id AND o.status IN ('pending','processing') AND o.expires_at>clock_timestamp();
 SELECT coalesce(jsonb_agg(to_jsonb(m)),'[]') INTO metrics FROM (
  SELECT value->>'name' name,sum((value->>'count')::int) count,
   sum(CASE WHEN value->>'outcome' IN ('error','timeout') THEN (value->>'count')::int ELSE 0 END) errors,
   round(sum((value->>'totalMs')::numeric)/greatest(1,sum((value->>'count')::int)),1) avg_ms,
   max((value->>'maxMs')::int) max_ms
  FROM private.operation_metric_batches b CROSS JOIN LATERAL jsonb_array_elements(b.rows)
  WHERE b.company_id=p_company_id AND b.received_at>clock_timestamp()-interval '24 hours' GROUP BY value->>'name'
 ) m;
 IF public.is_super_admin() THEN
  SELECT jsonb_build_object('used',coalesce(u.hits,0),'daily_limit',s.daily_limit,'quote_reserve',s.quote_reserve,'user_daily_limit',s.user_daily_limit,'ride_limit',s.ride_limit,'timezone','America/Los_Angeles') INTO budget
   FROM private.route_budget_settings s LEFT JOIN private.route_budget_usage u ON u.bucket='global' AND u.budget_day=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date WHERE s.singleton;
 END IF;
 result:=jsonb_build_object('checked_at',clock_timestamp(),'stale_online_drivers',stale,'flagged_rides_24h',flagged,
  'oldest_push_seconds',coalesce(queue_age,0),'metrics',metrics,'route_budget',budget,
  'company_routes',coalesce((SELECT jsonb_agg(to_jsonb(u)) FROM (SELECT quoted,reserved,denied FROM private.company_route_usage WHERE company_id=p_company_id AND budget_day=(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date) u),'[]'::jsonb));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.operational_health(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.operational_health(uuid) TO authenticated;
CREATE FUNCTION private.prune_operation_metrics() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 DELETE FROM private.company_route_usage WHERE budget_day<(clock_timestamp() AT TIME ZONE 'America/Los_Angeles')::date-7;
 DELETE FROM private.operation_metric_batches WHERE id IN
 (SELECT id FROM private.operation_metric_batches WHERE received_at<clock_timestamp()-interval '7 days' ORDER BY received_at LIMIT 20000);
$$;
REVOKE ALL ON FUNCTION private.prune_operation_metrics() FROM PUBLIC,anon,authenticated;
SELECT cron.schedule('prune-operation-metrics','*/10 * * * *','SELECT private.prune_operation_metrics()');

-- Keep accounting SECURITY INVOKER: the evidence join also respects RLS.
CREATE OR REPLACE FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'Invalid report period'; END IF;
 IF p_driver_id IS NULL AND (p_company_id IS NULL OR NOT(public.is_company_admin(p_company_id) OR public.is_super_admin())) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 IF p_driver_id IS NOT NULL AND NOT(public.is_driver(p_driver_id) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id AND (public.is_company_admin(d.company_id) OR public.is_super_admin()))) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id WHERE (p_company_id IS NULL OR o.company_id=p_company_id) AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND o.occurred_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND o.occurred_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), money AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal') reversed,
   EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='confirmation') confirmed
  FROM public.driver_money_entries e LEFT JOIN public.profiles p ON p.id=e.driver_user_id WHERE (p_company_id IS NULL OR e.company_id=p_company_id) AND (p_driver_id IS NULL OR e.driver_id=p_driver_id)
   AND e.recorded_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND e.recorded_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed),0) income,
   coalesce(sum(amount) FILTER(WHERE kind='expense' AND NOT reversed),0) expenses,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed),0) handed_over,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed AND confirmed),0) confirmed_handover,
   coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed AND confirmed),0) confirmed_income FROM money
 ) SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),
 'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM money),
 'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
 EXISTS(SELECT 1 FROM public.driver_money_entries conf WHERE conf.reference_id=e.id AND conf.kind='confirmation') company_confirmed,
 e.amount-o.booked_amount difference
 FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) o
 LEFT JOIN LATERAL (SELECT e.* FROM public.driver_money_entries e WHERE e.request_id=o.request_id AND e.kind='income'
  AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')
  ORDER BY e.recorded_at DESC,e.id LIMIT 1) e ON true
 WHERE o.outcome='completed')x),'[]'::jsonb),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT o.*, (SELECT to_jsonb(e) FROM public.ride_evidence e WHERE e.request_id=o.request_id) evidence FROM outcomes o ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END; $function$
;
