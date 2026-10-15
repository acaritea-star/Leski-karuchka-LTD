-- One durable inbox, three server-owned audiences. Broadcast carries hints only.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.notifications ADD COLUMN audience text NOT NULL DEFAULT 'customer'
 CHECK(audience IN ('customer','driver','company')),
 ADD COLUMN event_key text,
 ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('silent','normal','urgent')),
 ADD COLUMN expires_at timestamptz;
UPDATE public.notifications n SET audience=CASE
 WHEN n.data->>'role'='DRIVER' THEN 'driver'
 WHEN n.data->>'role'='CUSTOMER' THEN 'customer'
 WHEN p.role='DRIVER' THEN 'driver'
 WHEN p.role IN ('COMPANY_ADMIN','SUPER_ADMIN') THEN 'company' ELSE 'customer' END
 FROM public.profiles p WHERE p.id=n.user_id;
-- Only incoming offers expire from the inbox; completed-trip history remains.
UPDATE public.notifications SET expires_at=(data->>'expires_at')::timestamptz
 WHERE type='new_request' AND data->>'expires_at' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}';
CREATE UNIQUE INDEX notifications_event_once ON public.notifications(user_id,event_key) WHERE event_key IS NOT NULL;
CREATE INDEX notifications_audience_page ON public.notifications(user_id,audience,created_at DESC,id DESC);
CREATE INDEX notifications_audience_unread ON public.notifications(user_id,audience) WHERE NOT is_read;

CREATE FUNCTION private.current_notification_audience() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT CASE role WHEN 'CUSTOMER' THEN 'customer' WHEN 'DRIVER' THEN 'driver'
 WHEN 'COMPANY_ADMIN' THEN 'company' WHEN 'SUPER_ADMIN' THEN 'company' END
 FROM public.profiles WHERE id=auth.uid() AND is_active;
$f$;
REVOKE ALL ON FUNCTION private.current_notification_audience() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.current_notification_audience() TO authenticated;
DROP POLICY IF EXISTS notifications_select_admin ON public.notifications;
DROP POLICY IF EXISTS notifications_insert_admin ON public.notifications;
ALTER POLICY notifications_select_own ON public.notifications USING(
 user_id=(SELECT auth.uid()) AND audience=(SELECT private.current_notification_audience())
 AND (audience='customer' OR (audience='driver' AND public.is_driver_of_company(company_id))
 OR (audience='company' AND public.is_company_admin(company_id))));
ALTER POLICY notifications_update_own ON public.notifications USING(
 user_id=(SELECT auth.uid()) AND audience=(SELECT private.current_notification_audience())
 AND (audience='customer' OR (audience='driver' AND public.is_driver_of_company(company_id))
 OR (audience='company' AND public.is_company_admin(company_id)))) WITH CHECK(
 user_id=(SELECT auth.uid()) AND audience=(SELECT private.current_notification_audience())
 AND (audience='customer' OR (audience='driver' AND public.is_driver_of_company(company_id))
 OR (audience='company' AND public.is_company_admin(company_id))));

CREATE FUNCTION public.notification_inbox_state() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$
 SELECT jsonb_build_object('unread',(SELECT count(*) FROM public.notifications WHERE user_id=auth.uid()
 AND NOT is_read AND (expires_at IS NULL OR expires_at>now())),
 'latest_id',(SELECT id FROM public.notifications WHERE user_id=auth.uid() AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC,id DESC LIMIT 1));
$f$;
CREATE FUNCTION public.notification_inbox_page(p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$
 WITH page AS MATERIALIZED(SELECT id,audience,type,title,message,data,is_read,created_at,priority,expires_at
 FROM public.notifications WHERE user_id=auth.uid() AND (expires_at IS NULL OR expires_at>now())
 AND (p_before IS NULL OR (created_at,id)<(p_before,p_before_id)) ORDER BY created_at DESC,id DESC LIMIT 21)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY created_at DESC,id DESC)
 FROM(SELECT * FROM page ORDER BY created_at DESC,id DESC LIMIT 20)x),'[]'::jsonb),'has_more',(SELECT count(*)>20 FROM page));
$f$;
CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE changed integer;
BEGIN
 IF p_ids IS NOT NULL AND cardinality(p_ids)>100 THEN RAISE EXCEPTION 'Too many notifications'; END IF;
 UPDATE public.notifications SET is_read=true WHERE user_id=auth.uid() AND NOT is_read
 AND (p_ids IS NULL OR id=ANY(p_ids));
 GET DIAGNOSTICS changed=ROW_COUNT; RETURN changed;
END $f$;
REVOKE ALL ON FUNCTION public.notification_inbox_state(),public.notification_inbox_page(timestamptz,uuid),public.mark_notifications_read(uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.notification_inbox_state(),public.notification_inbox_page(timestamptz,uuid),public.mark_notifications_read(uuid[]) TO authenticated;

ALTER TABLE private.push_outbox ALTER COLUMN request_id DROP NOT NULL,
 ADD COLUMN notification_id uuid REFERENCES public.notifications(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX push_outbox_notification_once ON private.push_outbox(notification_id) WHERE notification_id IS NOT NULL;
ALTER TABLE private.push_outbox DROP CONSTRAINT push_outbox_event_type_check;
ALTER TABLE private.push_outbox ADD CONSTRAINT push_outbox_event_type_check CHECK(event_type IN
 ('new_request','accepted','arrived','in_progress','completed','cancelled','application_submitted',
 'application_approved','application_rejected','document_submitted','document_approved','document_rejected','document_expiring','request_unclaimed'));

CREATE FUNCTION private.notification_recipient_valid(p_user uuid,p_audience text,p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.is_active AND (
 (p_audience='customer' AND p.role='CUSTOMER') OR
 (p_audience='company' AND p.role='COMPANY_ADMIN' AND p.company_id=p_company AND EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_company AND c.is_active)) OR
 (p_audience='driver' AND p.role='DRIVER' AND p.company_id=p_company AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=p.id AND d.company_id=p_company))));
$f$;
REVOKE ALL ON FUNCTION private.notification_recipient_valid(uuid,text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.add_notification(p_user uuid,p_company uuid,p_audience text,p_kind text,p_key text,
 p_title text,p_message text,p_data jsonb DEFAULT '{}'::jsonb,p_request uuid DEFAULT NULL,
 p_priority text DEFAULT 'normal',p_expires timestamptz DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE nid uuid; delivery_until timestamptz:=coalesce(p_expires,clock_timestamp()+interval '5 minutes'); body jsonb;
BEGIN
 IF NOT private.notification_recipient_valid(p_user,p_audience,p_company) THEN RETURN NULL; END IF;
 INSERT INTO public.notifications(user_id,company_id,audience,type,event_key,title,message,data,priority,expires_at)
 VALUES(p_user,p_company,p_audience,CASE WHEN p_kind='cancelled' AND p_data->>'reason'='no_driver' THEN 'no_driver' ELSE p_kind END,p_key,p_title,p_message,p_data,
 CASE WHEN auth.uid()=p_user THEN 'silent' ELSE p_priority END,p_expires)
 ON CONFLICT(user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING RETURNING id INTO nid;
 IF nid IS NULL THEN RETURN NULL; END IF;
 IF auth.uid()=p_user OR p_priority='silent' THEN RETURN nid; END IF;
 body:=jsonb_build_object('title',p_title,'body',CASE WHEN p_kind='new_request'
 THEN 'Има заявка близо до теб. Отвори приложението за подробности.' ELSE p_message END,
 'icon','/icon-192.png','badge','/badge-72.png','tag',CASE WHEN p_request IS NULL THEN 'notice-'||nid ELSE 'request-'||p_request END,
 'renotify',false,'requireInteraction',false,'data',p_data||jsonb_build_object('notification_id',nid,'recipient_id',p_user,
 'type',CASE WHEN p_kind='new_request' THEN 'new_request' ELSE 'inbox' END,'role',CASE p_audience WHEN 'company' THEN 'COMPANY_ADMIN' ELSE upper(p_audience) END,
 'expires_at',delivery_until));
 INSERT INTO private.push_outbox(request_id,recipient_id,event_type,notification_id,payload,expires_at)
 VALUES(p_request,p_user,p_kind,nid,body,delivery_until) ON CONFLICT DO NOTHING;
 RETURN nid;
END $f$;
REVOKE ALL ON FUNCTION private.add_notification(uuid,uuid,text,text,text,text,text,jsonb,uuid,text,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.notify_company(p_company uuid,p_kind text,p_key text,p_title text,p_message text,
 p_data jsonb DEFAULT '{}'::jsonb,p_request uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE recipient uuid;
BEGIN
 FOR recipient IN SELECT id FROM public.profiles WHERE role='COMPANY_ADMIN' AND company_id=p_company AND is_active LOOP
  PERFORM private.add_notification(recipient,p_company,'company',p_kind,p_key,p_title,p_message,p_data,p_request);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION private.notify_company(uuid,text,text,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.broadcast_notification_hint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 BEGIN
  PERFORM realtime.send(jsonb_build_object('id',NEW.id,'is_new',TG_OP='INSERT','type',NEW.type,'priority',NEW.priority),
   'inbox_changed','inbox:'||NEW.user_id||':'||NEW.audience,true);
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.broadcast_notification_hint() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER broadcast_notification_hint AFTER INSERT OR UPDATE OF is_read ON public.notifications
 FOR EACH ROW EXECUTE FUNCTION private.broadcast_notification_hint();
CREATE POLICY personal_notification_broadcast ON realtime.messages FOR SELECT TO authenticated USING(
 extension='broadcast' AND (SELECT realtime.topic())='inbox:'||(SELECT auth.uid())||':'||(SELECT private.current_notification_audience()));

CREATE OR REPLACE FUNCTION private.enqueue_request_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE recipient uuid; kind text; title text; message text; deadline timestamptz; recipients uuid[]; audience text;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NEW.status<>'pending' THEN RETURN NEW; END IF;
 kind:=CASE WHEN NEW.status='pending' THEN 'new_request' ELSE NEW.status::text END;
 IF kind='new_request' THEN
  SELECT array_agg(user_id) INTO recipients FROM public.request_push_recipients(NEW.id);
  title:='Нова заявка'; message:=NEW.pickup_address||' → '||NEW.destination_address;
  deadline:=coalesce(NEW.expires_at,NEW.created_at+interval '2 minutes');
 ELSE
  recipients:=ARRAY[NEW.customer_id];
  IF kind='cancelled' AND NEW.driver_id IS NOT NULL THEN
   SELECT array_append(recipients,d.user_id) INTO recipients FROM public.drivers d WHERE d.id=NEW.driver_id;
  END IF;
  title:=CASE kind WHEN 'accepted' THEN 'Шофьор прие заявката' WHEN 'arrived' THEN 'Шофьорът пристигна'
   WHEN 'in_progress' THEN 'Курсът започна' WHEN 'completed' THEN 'Курсът приключи'
   WHEN 'cancelled' THEN CASE NEW.cancelled_by::text WHEN 'customer' THEN 'Клиентът отказа заявката'
    WHEN 'driver' THEN 'Шофьорът отказа заявката' ELSE 'Няма наличен шофьор' END END;
  message:=CASE kind WHEN 'accepted' THEN 'Виж шофьора и проследи пристигането.'
   WHEN 'arrived' THEN 'Шофьорът те очаква на мястото за вземане.' WHEN 'in_progress' THEN 'Можеш да следиш курса в приложението.'
   WHEN 'completed' THEN 'Виж курса и остави оценка.' ELSE 'Отвори приложението за актуалния статус и следващите възможности.' END;
 END IF;
 FOREACH recipient IN ARRAY coalesce(recipients,ARRAY[]::uuid[]) LOOP
  audience:=CASE WHEN recipient=NEW.customer_id THEN 'customer' ELSE 'driver' END;
  PERFORM private.add_notification(recipient,CASE WHEN audience='driver' THEN(SELECT company_id FROM public.drivers WHERE user_id=recipient) ELSE NEW.company_id END,
   audience,kind,'ride:'||NEW.id||':'||kind,title,message,
   jsonb_build_object('request_id',NEW.id,'status',NEW.status,'reason',NEW.cancel_reason),NEW.id,
   CASE WHEN kind IN ('new_request','arrived','cancelled') THEN 'urgent' WHEN kind='in_progress' THEN 'silent' ELSE 'normal' END,deadline);
  IF kind='new_request' THEN
   BEGIN PERFORM realtime.send(jsonb_build_object('request_id',NEW.id),'offer_changed','driver-offers:'||recipient,true); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
 END LOOP;
 IF kind<>'new_request' THEN
  FOR recipient IN SELECT recipient_id FROM private.push_outbox WHERE request_id=NEW.id AND event_type='new_request' LOOP
   BEGIN PERFORM realtime.send(jsonb_build_object('request_id',NEW.id),'offer_changed','driver-offers:'||recipient,true); EXCEPTION WHEN OTHERS THEN NULL; END;
   BEGIN PERFORM realtime.send('{}'::jsonb,'inbox_changed','inbox:'||recipient||':driver',true); EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
 END IF;
 IF kind='cancelled' AND NEW.cancel_reason='no_driver' THEN
  PERFORM private.notify_company(NEW.company_id,'request_unclaimed','unclaimed:'||NEW.id,'Заявка без приел шофьор',
   'Заявка изтече без потвърден шофьор. Прегледай наличността на екипа.',jsonb_build_object('request_id',NEW.id),NEW.id);
 END IF;
 PERFORM private.dispatch_push_outbox(); RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION public.claim_push_job(p_job_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE j private.push_outbox; r public.taxi_requests; n public.notifications; valid boolean:=true;
BEGIN
 SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
 OR j.lease_until<=clock_timestamp() OR j.claimed_at IS NOT NULL THEN RETURN NULL; END IF;
 IF j.notification_id IS NOT NULL THEN
  SELECT * INTO n FROM public.notifications WHERE id=j.notification_id;
  valid:=FOUND AND NOT n.is_read AND private.notification_recipient_valid(j.recipient_id,n.audience,n.company_id);
  IF n.type='application_submitted' THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_applications a WHERE a.id=(n.data->>'application_id')::uuid
    AND a.company_id=n.company_id AND a.status='pending' AND (NOT a.onboarding_required OR a.submitted_at IS NOT NULL));
  ELSIF n.type IN ('application_approved','application_rejected') THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_applications a WHERE a.id=(n.data->>'application_id')::uuid
    AND a.user_id=n.user_id AND a.company_id=n.company_id AND 'application_'||a.status=n.type);
  ELSIF n.type IN ('document_submitted','document_approved','document_rejected','document_expiring') THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=(n.data->>'document_id')::uuid
    AND d.company_id=n.company_id AND ((n.type='document_submitted' AND d.status='pending') OR
     (n.type='document_approved' AND d.status='approved') OR (n.type='document_rejected' AND d.status='rejected') OR
     (n.type='document_expiring' AND d.status='approved' AND d.expires_at=(n.data->>'expires_on')::date)));
  END IF;
 END IF;
 IF j.request_id IS NOT NULL THEN
  SELECT * INTO r FROM public.taxi_requests WHERE id=j.request_id;
  valid:=valid AND FOUND;
  IF j.event_type='new_request' THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.request_push_recipients(j.request_id) WHERE user_id=j.recipient_id);
  ELSIF j.event_type='request_unclaimed' THEN valid:=valid AND r.status='cancelled' AND r.cancel_reason='no_driver';
  ELSE valid:=valid AND r.status::text=j.event_type; END IF;
 END IF;
 IF j.expires_at<=clock_timestamp() OR NOT valid OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=j.recipient_id AND is_active) THEN
  UPDATE private.push_outbox SET status='skipped',last_error='NO_LONGER_ELIGIBLE',lease_token=NULL,lease_until=NULL WHERE id=j.id;
  RETURN NULL;
 END IF;
 UPDATE private.push_outbox SET claimed_at=clock_timestamp() WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'recipient_id',j.recipient_id,'payload',j.payload,'expires_at',j.expires_at,'lease_until',j.lease_until);
END $f$;

CREATE FUNCTION private.notify_driver_workflow() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE kind text; recipient uuid; audience text; details jsonb; title text;
BEGIN
 IF TG_TABLE_NAME='driver_applications' THEN
  details:=jsonb_build_object('application_id',NEW.id);
  IF NEW.status='pending' AND ((TG_OP='INSERT' AND NOT NEW.onboarding_required) OR
   (TG_OP='UPDATE' AND NEW.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)) THEN
   PERFORM private.notify_company(NEW.company_id,'application_submitted','application:'||NEW.id||':submitted:'||NEW.onboarding_revision,
    'Кандидатура за шофьор','Има нова кандидатура за преглед.',details);
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN
   SELECT CASE role WHEN 'DRIVER' THEN 'driver' ELSE 'customer' END INTO audience FROM public.profiles WHERE id=NEW.user_id;
   kind:='application_'||NEW.status;
   PERFORM private.add_notification(NEW.user_id,NEW.company_id,audience,kind,'application:'||NEW.id||':'||NEW.status||':'||NEW.onboarding_revision,
    CASE NEW.status WHEN 'approved' THEN 'Кандидатурата е одобрена' ELSE 'Кандидатурата изисква преглед' END,
    'Виж решението и следващите стъпки в приложението.',details);
  END IF;
 ELSE
  SELECT user_id INTO recipient FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id;
  details:=jsonb_build_object('document_id',NEW.id,'driver_id',NEW.driver_id);
  IF NEW.status='pending' AND (TG_OP='INSERT' OR (NEW.file_url,NEW.expires_at,NEW.status) IS DISTINCT FROM (OLD.file_url,OLD.expires_at,OLD.status)) THEN
   PERFORM private.notify_company(NEW.company_id,'document_submitted','document:'||NEW.id||':review:'||md5(coalesce(NEW.file_url,'')||coalesce(NEW.expires_at::text,'')),
    'Документ за преглед','Шофьорски документ очаква преглед.',details);
  ELSIF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved','rejected') THEN
   kind:='document_'||NEW.status;
   title:=CASE NEW.status WHEN 'approved' THEN 'Документът е одобрен' ELSE 'Документът изисква корекция' END;
   PERFORM private.add_notification(recipient,NEW.company_id,'driver',kind,'document:'||NEW.id||':'||NEW.status||':'||coalesce(NEW.reviewed_at::text,''),
    title,'Отвори профила си за подробности.',details);
  END IF;
 END IF;
 PERFORM private.dispatch_push_outbox(); RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.notify_driver_workflow() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER notify_application AFTER INSERT OR UPDATE OF status,submitted_at ON public.driver_applications FOR EACH ROW EXECUTE FUNCTION private.notify_driver_workflow();
CREATE TRIGGER notify_driver_document AFTER INSERT OR UPDATE OF status,file_url,expires_at ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.notify_driver_workflow();

-- Daily reminders are bounded, deduplicated and use the existing delivery queue.
CREATE FUNCTION private.notification_document_reminders() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE x record; today date:=(now() AT TIME ZONE 'Europe/Sofia')::date; days_left integer;
BEGIN
 FOR x IN SELECT doc.id,doc.driver_id,doc.company_id,doc.expires_at,d.user_id FROM public.driver_documents doc
 JOIN public.drivers d ON d.id=doc.driver_id AND d.company_id=doc.company_id
 WHERE doc.status='approved' AND doc.expires_at IN(today,today+1,today+7) AND doc.created_at<now()
 AND NOT EXISTS(SELECT 1 FROM public.driver_documents newer WHERE newer.driver_id=doc.driver_id AND newer.type=doc.type AND newer.status='approved' AND newer.expires_at>doc.expires_at)
 AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=d.user_id AND p.is_active AND p.role='DRIVER' AND p.company_id=d.company_id)
 AND NOT EXISTS(SELECT 1 FROM public.notifications n WHERE n.user_id=d.user_id AND n.event_key='document:'||doc.id||':expires:'||doc.expires_at||':'||(doc.expires_at-today))
 ORDER BY doc.expires_at,doc.id LIMIT 500 LOOP
  days_left:=x.expires_at-today;
  PERFORM private.add_notification(x.user_id,x.company_id,'driver','document_expiring','document:'||x.id||':expires:'||x.expires_at||':'||days_left,
   'Провери срока на документ','Документ изтича скоро или днес. Отвори профила си за подробности.',jsonb_build_object('document_id',x.id,'driver_id',x.driver_id,'expires_on',x.expires_at));
  PERFORM private.notify_company(x.company_id,'document_expiring','document:'||x.id||':expires:'||x.expires_at||':'||days_left,
   'Шофьорски документ изтича','Прегледай документите и наличността на шофьора.',jsonb_build_object('document_id',x.id,'driver_id',x.driver_id,'expires_on',x.expires_at));
 END LOOP;
 PERFORM private.dispatch_push_outbox();
END $f$;
REVOKE ALL ON FUNCTION private.notification_document_reminders() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('leski-document-notifications','*/10 7-9 * * *','SELECT private.notification_document_reminders()');

CREATE FUNCTION public.open_notification(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE n public.notifications; r public.taxi_requests; path text;
BEGIN
 SELECT * INTO n FROM public.notifications WHERE id=p_id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Известието не е достъпно за този профил.' USING ERRCODE='42501'; END IF;
 IF n.audience='company' THEN
  path:=CASE WHEN n.data->>'request_id' IS NOT NULL THEN '/admin/orders?request='||(n.data->>'request_id')
   WHEN n.data->>'application_id' IS NOT NULL THEN '/admin/drivers?application='||(n.data->>'application_id')
   WHEN n.data->>'driver_id' IS NOT NULL THEN '/admin/drivers?driver='||(n.data->>'driver_id') ELSE '/admin/drivers' END;
 ELSIF n.audience='driver' THEN
  path:=CASE WHEN n.data->>'request_id' IS NOT NULL THEN '/driver/requests' ELSE '/driver/profile' END;
 ELSIF n.data->>'application_id' IS NOT NULL THEN path:='/driver-join?company='||n.company_id;
 ELSIF n.data->>'request_id' IS NOT NULL THEN
  SELECT * INTO r FROM public.taxi_requests WHERE id=(n.data->>'request_id')::uuid AND customer_id=auth.uid();
  path:=CASE WHEN NOT FOUND THEN '/customer/orders' WHEN r.status='completed' AND r.driver_id IS NOT NULL
   THEN '/customer/orders?rate='||r.id WHEN r.status='cancelled' THEN '/customer/home?retry='||r.id ELSE '/customer/home' END;
 ELSE path:='/customer/home'; END IF;
 UPDATE public.notifications SET is_read=true WHERE id=n.id;
 RETURN path;
END $f$;
REVOKE ALL ON FUNCTION public.open_notification(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.open_notification(uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
