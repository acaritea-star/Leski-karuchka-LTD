-- Consolidates the previously unshipped cash/geo/push migration.
-- Existing request, trip and payment history is preserved.
-- One eligibility rule for the request feed, acceptance and push recipients.
CREATE OR REPLACE FUNCTION private.eligible_drivers(
  p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL
) RETURNS TABLE(driver_id uuid, user_id uuid)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.id, d.user_id
  FROM public.drivers d
  JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
  JOIN public.companies c ON c.id=d.company_id AND c.is_active
  JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
  JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
  JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=d.company_id
  WHERE d.company_id=p_company AND v.vehicle_type_id=p_type
    AND (p_user IS NULL OR d.user_id=p_user) AND d.is_online AND d.is_verified
    AND l.updated_at > clock_timestamp()-interval '45 seconds'
    AND l.position_at > clock_timestamp()-interval '45 seconds'
    AND l.accuracy BETWEEN 0 AND 100
    AND l.position_at <= clock_timestamp()+interval '30 seconds'
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
) RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
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
RETURNS TABLE(user_id uuid) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
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

-- Set the default separately: adding the column must not rewrite old requests.
ALTER TABLE public.taxi_requests ADD COLUMN expires_at timestamptz;
ALTER TABLE public.taxi_requests ALTER COLUMN expires_at SET DEFAULT (clock_timestamp()+interval '2 minutes');

CREATE OR REPLACE FUNCTION private.guard_request_dispatch() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
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
END $$;

ALTER POLICY taxi_requests_select_driver ON public.taxi_requests USING (
  public.is_driver(driver_id) OR public.is_company_admin(company_id) OR public.is_super_admin()
  OR (status='pending' AND clock_timestamp()<COALESCE(expires_at,created_at+interval '2 minutes')
    AND private.can_receive_request(company_id,vehicle_type_id,pickup_latitude,pickup_longitude)));
ALTER POLICY taxi_requests_update_driver ON public.taxi_requests USING (
  public.is_driver(driver_id)
  OR (status='pending' AND clock_timestamp()<COALESCE(expires_at,created_at+interval '2 minutes')
    AND private.can_receive_request(company_id,vehicle_type_id,pickup_latitude,pickup_longitude)));

CREATE OR REPLACE FUNCTION public.request_push_recipients(p_request_id uuid)
RETURNS TABLE(user_id uuid) LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT d.user_id FROM public.taxi_requests r
  CROSS JOIN LATERAL private.eligible_drivers(r.company_id,r.vehicle_type_id,r.pickup_latitude,r.pickup_longitude) d
  WHERE r.id=p_request_id AND r.status='pending'
    AND clock_timestamp()<COALESCE(r.expires_at,r.created_at+interval '2 minutes');
$$;

-- Invoker security retains both RLS and the existing transition/price guards.
-- Request-then-driver lock order also matches the legacy UPDATE path.
CREATE OR REPLACE FUNCTION public.accept_taxi_request(p_request_id uuid)
RETURNS public.taxi_requests LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.taxi_requests; d public.drivers;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  SELECT * INTO d FROM public.drivers
    WHERE user_id=auth.uid() AND company_id=r.company_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN
    RAISE EXCEPTION 'Active driver account required' USING ERRCODE='42501';
  END IF;
  IF r.status='accepted' AND r.driver_id=d.id THEN RETURN r; END IF;
  IF r.status<>'pending' OR clock_timestamp()>=COALESCE(r.expires_at,r.created_at+interval '2 minutes') THEN
    RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.';
  END IF;
  UPDATE public.taxi_requests SET driver_id=d.id,status='accepted'
    WHERE id=r.id AND status='pending' RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заявката вече не е налична. Обнови списъка.'; END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.accept_taxi_request(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_taxi_request(uuid) TO authenticated;

-- Customers can see their assigned driver during an active request. Own/admin
-- policies remain in place; unrelated signed-in users cannot enumerate drivers.
ALTER POLICY drivers_select_authenticated ON public.drivers USING (
  EXISTS(SELECT 1 FROM public.taxi_requests r WHERE r.driver_id=drivers.id
    AND r.customer_id=(SELECT auth.uid()) AND r.status IN ('accepted','arrived','in_progress')));
DROP POLICY IF EXISTS notifications_insert_driver ON public.notifications;
ALTER POLICY driver_documents_insert_driver ON public.driver_documents WITH CHECK (
  public.is_driver(driver_id) AND EXISTS(SELECT 1 FROM public.drivers d
    WHERE d.id=driver_documents.driver_id AND d.company_id=driver_documents.company_id));

-- A logged table survives restarts even though pg_net's HTTP queue is unlogged.
CREATE TABLE private.push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.taxi_requests(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK(event_type IN ('new_request','accepted','arrived','in_progress','completed','cancelled')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  lease_token uuid,
  lease_until timestamptz,
  claimed_at timestamptz,
  http_request_id bigint,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(request_id,event_type,recipient_id)
);
CREATE INDEX push_outbox_recipient ON private.push_outbox(recipient_id);
CREATE INDEX push_outbox_due ON private.push_outbox(available_at) WHERE status IN ('pending','processing');
ALTER TABLE private.push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.push_outbox FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.dispatch_push_outbox() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.push_outbox; token uuid; http_id bigint; kicked integer:=0;
BEGIN
  UPDATE private.push_outbox SET status='skipped',last_error='EXPIRED',lease_token=NULL,lease_until=NULL
    WHERE status IN ('pending','processing') AND expires_at<=clock_timestamp();
  UPDATE private.push_outbox SET status='failed',last_error='RETRY_LIMIT',lease_token=NULL,lease_until=NULL
    WHERE status='processing' AND lease_until<=clock_timestamp() AND attempts>=5;
  FOR j IN SELECT * FROM private.push_outbox
    WHERE expires_at>clock_timestamp() AND attempts<5
      AND ((status='pending' AND available_at<=clock_timestamp())
        OR (status='processing' AND lease_until<=clock_timestamp()))
    ORDER BY available_at,id LIMIT 20 FOR UPDATE SKIP LOCKED
  LOOP
    token:=gen_random_uuid();
    UPDATE private.push_outbox SET status='processing',attempts=attempts+1,
      lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL
      WHERE id=j.id;
    BEGIN
      -- A short-lived, single-use job capability is the worker's custom auth.
      -- Only service-role RPCs can consume it. No server secret is stored in SQL.
      SELECT net.http_post(
        url:='https://rzjyvxmfqnnxglmgnvma.supabase.co/functions/v1/deliver-push',
        body:=jsonb_build_object('job_id',j.id,'lease_token',token),
        headers:='{"Content-Type":"application/json"}'::jsonb,
        timeout_milliseconds:=10000) INTO http_id;
      UPDATE private.push_outbox SET http_request_id=http_id WHERE id=j.id;
      kicked:=kicked+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE private.push_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
        available_at=clock_timestamp()+interval '10 seconds',lease_token=NULL,lease_until=NULL,
        last_error='HTTP_ENQUEUE_FAILED' WHERE id=j.id;
    END;
  END LOOP;
  DELETE FROM private.push_outbox
    WHERE status IN ('sent','failed','skipped') AND created_at<clock_timestamp()-interval '7 days';
  RETURN kicked;
END $$;
REVOKE ALL ON FUNCTION private.dispatch_push_outbox() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.enqueue_request_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION private.enqueue_request_push() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER enqueue_request_push AFTER INSERT OR UPDATE OF status ON public.taxi_requests
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_request_push();

-- Only the worker's service role may exchange or complete a capability. A
-- concurrent replay cannot claim the same lease; stale leases are never valid.
CREATE OR REPLACE FUNCTION public.claim_push_job(p_job_id uuid,p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.push_outbox; r public.taxi_requests;
BEGIN
  SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
    OR j.lease_until<=clock_timestamp() OR j.claimed_at IS NOT NULL THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.taxi_requests WHERE id=j.request_id;
  IF j.expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=j.recipient_id AND is_active)
    OR (j.event_type='new_request' AND NOT EXISTS(SELECT 1 FROM public.request_push_recipients(j.request_id) WHERE user_id=j.recipient_id))
    OR (j.event_type<>'new_request' AND r.status::text<>j.event_type) THEN
    UPDATE private.push_outbox SET status='skipped',last_error='NO_LONGER_ELIGIBLE',lease_token=NULL,lease_until=NULL WHERE id=j.id;
    RETURN NULL;
  END IF;
  UPDATE private.push_outbox SET claimed_at=clock_timestamp() WHERE id=j.id;
  RETURN jsonb_build_object('id',j.id,'recipient_id',j.recipient_id,'payload',j.payload,'expires_at',j.expires_at,'lease_until',j.lease_until);
END $$;
REVOKE ALL ON FUNCTION public.claim_push_job(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_job(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.finish_push_job(p_job_id uuid,p_lease_token uuid,p_result text,p_error text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j private.push_outbox; outcome text;
BEGIN
  IF p_result NOT IN ('sent','retry','skipped','failed') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
  IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
    OR j.claimed_at IS NULL OR j.lease_until<=clock_timestamp() THEN RETURN false; END IF;
  outcome:=CASE WHEN p_result='retry' THEN CASE WHEN j.attempts>=5 THEN 'failed'
      WHEN j.expires_at<=clock_timestamp() THEN 'skipped' ELSE 'pending' END ELSE p_result END;
  UPDATE private.push_outbox SET status=outcome,
    available_at=clock_timestamp()+make_interval(secs=>LEAST(30,power(2,j.attempts)::integer)),
    lease_token=NULL,lease_until=NULL,last_error=left(p_error,80) WHERE id=j.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.finish_push_job(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finish_push_job(uuid,uuid,text,text) TO service_role;

-- Legacy clients may wake existing jobs, but never supply recipient/text/jobs.
CREATE OR REPLACE FUNCTION public.wake_request_push(p_request_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.taxi_requests;
BEGIN
  SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
    OR NOT (r.customer_id=auth.uid() OR public.is_driver(r.driver_id)
      OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Forbidden request' USING ERRCODE='42501';
  END IF;
  RETURN private.dispatch_push_outbox();
END $$;
REVOKE ALL ON FUNCTION public.wake_request_push(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wake_request_push(uuid) TO authenticated;

-- Cancellation notifications are now produced by the same atomic event trigger.
CREATE OR REPLACE FUNCTION public.expire_stale_requests() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.taxi_requests SET status='cancelled',cancelled_at=clock_timestamp(),cancelled_by='system',cancel_reason='no_driver'
    WHERE status='pending' AND COALESCE(expires_at,created_at+interval '2 minutes')<=clock_timestamp();
END $$;
REVOKE ALL ON FUNCTION public.expire_stale_requests() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_requests() TO service_role;

CREATE OR REPLACE FUNCTION private.maintain_dispatch() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.expire_stale_requests();
  PERFORM private.dispatch_push_outbox();
END $$;
REVOKE ALL ON FUNCTION private.maintain_dispatch() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('leski-dispatch','10 seconds','SELECT private.maintain_dispatch()');

DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND schemaname='public' AND tablename='notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
NOTIFY pgrst,'reload schema';
