-- Synthetic data only; never commits or contacts push providers.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE OR REPLACE FUNCTION private.dispatch_push_outbox() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT 0 $$;
CREATE FUNCTION pg_temp.notice_denied(q text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
 BEGIN EXECUTE q; EXCEPTION WHEN insufficient_privilege OR raise_exception THEN RETURN; END;
 RAISE EXCEPTION 'FAIL allowed forbidden notification operation: %',q;
END $f$;
DO $test$
DECLARE ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); aa uuid:=gen_random_uuid(); ab uuid:=gen_random_uuid();
 da_user uuid:=gen_random_uuid(); db_user uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid();
 da uuid; db uuid; nc uuid; nd uuid; na uuid; nb uuid; hidden uuid:=gen_random_uuid(); nid uuid;
 application uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); job uuid; token uuid:=gen_random_uuid();
 state jsonb; page jsonb; path text; next_id uuid; i integer;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 INSERT INTO public.companies(id,name,slug,setup_completed_at) VALUES(ca,'Notice Orion','notice-'||ca,now()),(cb,'Notice Duvka','notice-'||cb,now());
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT u,'notification-'||u||'@example.invalid',now() FROM unnest(ARRAY[aa,ab,da_user,db_user,customer,candidate])u;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=ca WHERE id=aa;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=cb WHERE id=ab;
 UPDATE public.profiles SET role='DRIVER',company_id=ca WHERE id=da_user;
 UPDATE public.profiles SET role='DRIVER',company_id=cb WHERE id=db_user;
 SELECT id INTO da FROM public.drivers WHERE user_id=da_user;
 SELECT id INTO db FROM public.drivers WHERE user_id=db_user;
 nc:=private.add_notification(customer,ca,'customer','accepted','notice-c','Customer only','Synthetic');
 nd:=private.add_notification(da_user,ca,'driver','accepted','notice-d','Driver only','Synthetic');
 na:=private.add_notification(aa,ca,'company','request_unclaimed','notice-a','Orion only','Synthetic');
 nb:=private.add_notification(ab,cb,'company','request_unclaimed','notice-b','Duvka only','Synthetic');
 IF private.add_notification(da_user,cb,'driver','accepted','cross-firm','Wrong firm','Synthetic') IS NOT NULL
 OR private.add_notification(aa,ca,'customer','accepted','wrong-role','Wrong role','Synthetic') IS NOT NULL THEN RAISE EXCEPTION 'FAIL unsafe recipient accepted'; END IF;
 IF private.add_notification(customer,ca,'customer','accepted','notice-c','Duplicate','Synthetic') IS NOT NULL THEN RAISE EXCEPTION 'FAIL duplicated event'; END IF;
 INSERT INTO public.notifications(id,user_id,company_id,audience,title) VALUES(hidden,aa,cb,'company','Legacy wrong company');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',aa,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF (SELECT count(*) FROM public.notifications WHERE id IN(nc,nd,na,nb,hidden))<>1 OR NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=na)
 THEN RAISE EXCEPTION 'FAIL company inbox crossed audience/recipient/firm'; END IF;
 state:=public.notification_inbox_state();
 IF (state->>'unread')::int<>1 THEN RAISE EXCEPTION 'FAIL own unread summary'; END IF;
 PERFORM pg_temp.notice_denied(format('SELECT public.open_notification(%L)',nb));
 PERFORM pg_temp.notice_denied(format('UPDATE public.notifications SET user_id=%L WHERE id=%L',ab,na));
 PERFORM pg_temp.notice_denied('SELECT * FROM private.push_outbox');
 PERFORM pg_temp.notice_denied('SELECT public.claim_push_job(gen_random_uuid(),gen_random_uuid())');
 i:=public.mark_notifications_read(); state:=public.notification_inbox_state();
 IF i<>1 OR (state->>'unread')::int<>0 THEN RAISE EXCEPTION 'FAIL scoped mark-read: updated %, state %',i,state; END IF;
 RESET ROLE;
 IF (SELECT is_read FROM public.notifications WHERE id=nb) THEN RAISE EXCEPTION 'FAIL mark-read affected another firm'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',da_user,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF (SELECT count(*) FROM public.notifications WHERE id IN(nc,nd,na,nb))<>1 THEN RAISE EXCEPTION 'FAIL driver inbox audience'; END IF;
 RESET ROLE;
 -- Role and firm revocation affect the read API and already queued deliveries.
 SELECT id INTO job FROM private.push_outbox WHERE notification_id=nd;
 PERFORM set_config('request.jwt.claims','{}',true);
 UPDATE private.push_outbox SET status='processing',lease_token=token,lease_until=clock_timestamp()+interval '30 seconds',attempts=1 WHERE id=job;
 UPDATE public.profiles SET company_id=cb WHERE id=da_user;
 IF public.claim_push_job(job,token) IS NOT NULL THEN RAISE EXCEPTION 'FAIL delivery after company revocation'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',da_user,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE id=nd) THEN RAISE EXCEPTION 'FAIL read after firm revocation'; END IF;
 RESET ROLE;
 UPDATE public.profiles SET company_id=ca WHERE id=da_user;
 PERFORM set_config('request.jwt.claims','{}',true);
 -- Empty drafts do not notify the firm. Submission is exactly once per revision.
 INSERT INTO public.driver_applications(id,user_id,company_id,full_name,phone,experience,has_vehicle,status,onboarding_required)
 VALUES(application,candidate,ca,'Synthetic candidate','0888123456','1–3',false,'pending',true);
 IF EXISTS(SELECT 1 FROM public.notifications WHERE data->>'application_id'=application::text) THEN RAISE EXCEPTION 'FAIL draft sent as application'; END IF;
 UPDATE public.driver_applications SET submitted_at=clock_timestamp(),onboarding_revision=1 WHERE id=application;
 UPDATE public.driver_applications SET submitted_at=submitted_at WHERE id=application;
 IF (SELECT count(*) FROM public.notifications WHERE type='application_submitted' AND data->>'application_id'=application::text)<>1 THEN RAISE EXCEPTION 'FAIL duplicate application submission'; END IF;
 UPDATE public.driver_applications SET status='rejected',review_note='Synthetic correction' WHERE id=application;
 SELECT id INTO nid FROM public.notifications WHERE user_id=candidate AND type='application_rejected';
 IF nid IS NULL THEN RAISE EXCEPTION 'FAIL candidate missed decision'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 path:=public.open_notification(nid);
 IF path<>'/driver-join?company='||ca THEN RAISE EXCEPTION 'FAIL candidate decision destination'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 INSERT INTO storage.objects(bucket_id,name) VALUES('driver-documents',da_user||'/'||document||'.pdf');
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,expires_at,file_url,status,created_at)
 VALUES(document,da,ca,'license',today+7,'storage://driver-documents/'||da_user||'/'||document||'.pdf','pending',now()-interval '1 hour');
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=aa AND type='document_submitted' AND data->>'document_id'=document::text)
 OR EXISTS(SELECT 1 FROM public.notifications WHERE user_id=ab AND data->>'document_id'=document::text) THEN RAISE EXCEPTION 'FAIL document company audience'; END IF;
 UPDATE public.driver_documents SET status='approved',reviewed_at=clock_timestamp() WHERE id=document;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=da_user AND type='document_approved' AND data->>'document_id'=document::text) THEN RAISE EXCEPTION 'FAIL document decision'; END IF;
 PERFORM private.notification_document_reminders(); PERFORM private.notification_document_reminders();
 IF (SELECT count(*) FROM public.notifications WHERE type='document_expiring' AND data->>'document_id'=document::text)<>2 THEN RAISE EXCEPTION 'FAIL reminder deduplication'; END IF;
 -- Stable keyset pagination includes same-timestamp rows without duplicates.
 FOR i IN 1..25 LOOP
  PERFORM private.add_notification(customer,ca,'customer','completed','page-'||i,'Page '||i,'Synthetic');
 END LOOP;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',customer,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 page:=public.notification_inbox_page();
 IF jsonb_array_length(page->'items')<>20 OR (page->>'has_more')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL bounded inbox page'; END IF;
 page:=public.notification_inbox_page((page#>>'{items,19,created_at}')::timestamptz,(page#>>'{items,19,id}')::uuid);
 IF jsonb_array_length(page->'items')<>6 OR (page->>'has_more')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'FAIL inbox cursor'; END IF;
 RESET ROLE;
 -- A visible UI action is stored, but does not push back to its actor.
 PERFORM private.add_notification(customer,ca,'customer','cancelled','self-cancel','Own cancellation','Synthetic');
 IF EXISTS(SELECT 1 FROM private.push_outbox o JOIN public.notifications n ON n.id=o.notification_id WHERE n.event_key='self-cancel') THEN RAISE EXCEPTION 'FAIL self-action generated a push'; END IF;
END $test$;
ROLLBACK;
SELECT 'PASS: role inboxes, company isolation, queue revocation, permission boundaries, decisions, reminders, pagination and actor silence' AS result;
