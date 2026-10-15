BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
DROP TRIGGER IF EXISTS notify_application ON public.driver_applications;
DROP TRIGGER IF EXISTS notify_driver_document ON public.driver_documents;
DROP TRIGGER IF EXISTS broadcast_notification_hint ON public.notifications;
DROP POLICY IF EXISTS personal_notification_broadcast ON realtime.messages;
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='leski-document-notifications';
UPDATE private.push_outbox SET status='skipped',last_error='FEATURE_ROLLBACK',lease_token=NULL,lease_until=NULL WHERE event_type NOT IN ('new_request','accepted','arrived','in_progress','completed','cancelled') AND status IN ('pending','processing');
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
        VALUES(recipient,CASE WHEN kind='new_request' THEN (SELECT company_id FROM public.drivers WHERE user_id=recipient) ELSE NEW.company_id END,
          notification_type,title,message,payload->'data',false);
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
;
CREATE OR REPLACE FUNCTION public.claim_push_job(p_job_id uuid, p_lease_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
END $function$
;
ALTER POLICY notifications_select_own ON public.notifications USING(user_id=(SELECT auth.uid()));
ALTER POLICY notifications_update_own ON public.notifications USING(user_id=(SELECT auth.uid())) WITH CHECK(user_id=(SELECT auth.uid()));
CREATE POLICY notifications_select_admin ON public.notifications FOR SELECT TO authenticated USING(public.is_company_admin(company_id) OR (SELECT public.is_super_admin()));
-- Additive columns and historical rows are retained. Application write grants remain restricted.
NOTIFY pgrst,'reload schema';
COMMIT;
