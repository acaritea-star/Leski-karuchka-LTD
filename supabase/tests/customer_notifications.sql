-- Two real Auth customers in a rollback-only transaction; no provider HTTP.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE OR REPLACE FUNCTION private.dispatch_push_outbox() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT 0 $$;
CREATE FUNCTION pg_temp.customer_notice_denied(q text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN; END;
 RAISE EXCEPTION 'FAIL forbidden customer notification operation: %',q;
END $f$;
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); firm uuid:=gen_random_uuid();
 na uuid; nb uuid; ride uuid:=gen_random_uuid(); job uuid; token uuid:=gen_random_uuid(); result jsonb; changed integer;
 device_endpoint text:='https://fcm.googleapis.com/synthetic-'||gen_random_uuid();
BEGIN
 INSERT INTO public.companies(id,name,slug,setup_completed_at) VALUES(firm,'Customer notices','notice-'||firm,now());
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT u,'notice-'||u||'@example.invalid',now() FROM unnest(ARRAY[a,b])u;
 na:=private.add_notification(a,firm,'customer','accepted','own-a','Customer A','Synthetic');
 nb:=private.add_notification(b,firm,'customer','accepted','own-b','Customer B','Synthetic');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 PERFORM set_config('realtime.topic','inbox:'||a||':customer',true);
 SET LOCAL ROLE authenticated;
 IF (SELECT count(*) FROM public.notifications WHERE id IN(na,nb))<>1
 OR NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=na)
 OR public.notification_inbox_state()->>'unread'<>'1'
 OR jsonb_array_length(public.notification_inbox_page()->'items')<>1 THEN RAISE EXCEPTION 'FAIL customer A read foreign inbox'; END IF;
 IF NOT EXISTS(SELECT 1 FROM realtime.messages WHERE topic='inbox:'||a||':customer' AND extension='broadcast' AND private)
 THEN RAISE EXCEPTION 'FAIL own customer broadcast denied'; END IF;
 PERFORM set_config('realtime.topic','inbox:'||b||':customer',true);
 IF EXISTS(SELECT 1 FROM realtime.messages WHERE topic='inbox:'||b||':customer') THEN RAISE EXCEPTION 'FAIL foreign customer channel joined'; END IF;
 PERFORM pg_temp.customer_notice_denied(format('SELECT public.open_notification(%L)',nb));
 changed:=public.mark_notifications_read(ARRAY[nb]);
 IF changed<>0 THEN RAISE EXCEPTION 'FAIL foreign mark-read RPC'; END IF;
 UPDATE public.notifications SET is_read=true WHERE id=nb;
 GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'FAIL foreign mark-read table'; END IF;
 PERFORM pg_temp.customer_notice_denied(format('UPDATE public.notifications SET user_id=%L WHERE id=%L',b,na));
 PERFORM public.register_push_subscription(device_endpoint,repeat('p',87),repeat('a',22),'Synthetic A');
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE id=na) OR EXISTS(SELECT 1 FROM public.push_subscriptions WHERE endpoint=device_endpoint AND user_id=a)
 THEN RAISE EXCEPTION 'FAIL customer B read customer A'; END IF;
 PERFORM public.register_push_subscription(device_endpoint,repeat('p',87),repeat('a',22),'Synthetic B');
 RESET ROLE;
 IF (SELECT count(*) FROM public.push_subscriptions s WHERE s.endpoint=device_endpoint AND s.is_active)<>1
 OR NOT EXISTS(SELECT 1 FROM public.push_subscriptions s WHERE s.endpoint=device_endpoint AND s.user_id=b AND s.is_active)
 OR EXISTS(SELECT 1 FROM public.notifications WHERE id=nb AND is_read)
 THEN RAISE EXCEPTION 'FAIL shared endpoint ownership or foreign mark-read'; END IF;
 SELECT id INTO job FROM private.push_outbox WHERE notification_id=na;
 -- Corrupted internal recipient cannot redirect another customer's notification.
 UPDATE private.push_outbox SET recipient_id=b,payload=jsonb_set(payload,'{data,recipient_id}',to_jsonb(b::text)),
 status='processing',lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL WHERE id=job;
 PERFORM set_config('request.jwt.claims','{}',true);
 IF public.claim_push_job(job,token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL mismatched notification owner delivered'; END IF;
 UPDATE private.push_outbox SET recipient_id=a,status='processing',lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL WHERE id=job;
 IF public.claim_push_job(job,token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL mismatched payload recipient delivered'; END IF;
 UPDATE private.push_outbox SET payload=jsonb_set(payload,'{data,recipient_id}',to_jsonb(a::text)),
 status='processing',lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL WHERE id=job;
 -- Even a consistently malformed notice/outbox must not target another ride's customer.
 INSERT INTO public.taxi_requests(id,company_id,customer_id,pickup_latitude,pickup_longitude,destination_latitude,destination_longitude,status)
 VALUES(ride,firm,b,43.3592,25.1358,43.37,25.14,'cancelled');
 UPDATE private.push_outbox SET request_id=ride,event_type='cancelled' WHERE id=job;
 IF public.claim_push_job(job,token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL foreign ride customer delivered'; END IF;
 UPDATE private.push_outbox SET request_id=NULL,status='processing',lease_token=token,
 lease_until=clock_timestamp()+interval '30 seconds',claimed_at=NULL WHERE id=job;
 result:=public.claim_push_job(job,token);
 IF result IS NULL OR result->>'recipient_id'<>a::text THEN RAISE EXCEPTION 'FAIL valid customer delivery denied'; END IF;
END $test$;
ROLLBACK;
SELECT 'PASS: two-customer inbox, read/open boundaries, private channels, endpoint rotation and queued recipient integrity' AS result;
