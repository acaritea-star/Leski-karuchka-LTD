BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.review_driver_application(p_id uuid, p_decision text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.driver_applications; p public.profiles; uid uuid:=auth.uid(); target_user uuid;
BEGIN
 -- Same lock order as submission: profile, then application.
 SELECT user_id INTO target_user FROM public.driver_applications WHERE id=p_id;
 SELECT * INTO p FROM public.profiles WHERE id=target_user FOR UPDATE;
 SELECT * INTO a FROM public.driver_applications WHERE id=p_id FOR UPDATE;
 IF uid IS NULL OR NOT FOUND OR NOT(public.is_company_admin(a.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате права за тази кандидатура.' USING ERRCODE='42501'; END IF;
 IF p_decision IS NULL OR p_decision NOT IN ('approved','rejected') OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Невалидно решение.'; END IF;
 IF a.status=p_decision THEN RETURN a.id; END IF;
 IF a.status<>'pending' THEN RAISE EXCEPTION 'Кандидатурата вече е разгледана. Обновете списъка.'; END IF;
 IF p_decision='approved' THEN
  IF p.role<>'CUSTOMER' OR NOT p.is_active OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=p.id) THEN RAISE EXCEPTION 'Профилът вече има друга роля или е неактивен.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=a.company_id AND is_active) THEN RAISE EXCEPTION 'Фирмата е неактивна.'; END IF;
  IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE customer_id=p.id AND status IN ('pending','accepted','arrived','in_progress')) THEN
   RAISE EXCEPTION 'Кандидатът има незавършена клиентска заявка. Опитайте след приключването ѝ.'; END IF;
  UPDATE public.profiles SET role='DRIVER',company_id=a.company_id,phone=a.phone,
   first_name=split_part(a.full_name,' ',1),last_name=btrim(substr(a.full_name,length(split_part(a.full_name,' ',1))+1)) WHERE id=p.id;
  -- handle_driver_role creates an unverified, offline driver. Never grant verification here.
 END IF;
 UPDATE public.driver_applications SET status=p_decision,review_note=btrim(coalesce(p_note,'')),reviewed_by=uid,reviewed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=a.id;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(a.company_id,uid,'driver_application',a.id,'application_'||p_decision,jsonb_build_object('status',p_decision));
 RETURN a.id;
END $function$
;
CREATE OR REPLACE FUNCTION public.export_my_basic_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('generated_at',clock_timestamp(),'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=uid),
 'driver_applications',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_applications WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'legal_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.legal_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'driver_preparation_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_preparation_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'privacy_requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.privacy_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'money_entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_money_entries WHERE driver_user_id=uid ORDER BY recorded_at DESC LIMIT 1000)x),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,created_at,pickup_address,destination_address,estimated_price FROM public.taxi_requests WHERE customer_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $function$
;
-- Preserve submitted documents and receipts. Disable new RPC entry points instead of dropping data.
REVOKE EXECUTE ON FUNCTION public.driver_onboarding(uuid),public.accept_application_preparation(uuid,text,text,text,jsonb,text,text),public.register_application_document(uuid,uuid,public.document_type,date,text),public.save_application_vehicle(uuid,boolean,jsonb),public.submit_driver_onboarding(uuid,integer),public.verify_driver_application(uuid,integer,uuid,uuid,boolean,text) FROM authenticated;
ALTER TABLE public.driver_applications ALTER COLUMN onboarding_required SET DEFAULT false;
DROP POLICY IF EXISTS application_files_insert ON storage.objects;
REVOKE EXECUTE ON FUNCTION public.reopen_driver_onboarding(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.begin_driver_onboarding(uuid,text,text,text,boolean,text) FROM authenticated;
CREATE OR REPLACE FUNCTION public.submit_driver_application(p_company uuid, p_full_name text, p_phone text, p_experience text, p_has_vehicle boolean, p_message text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE uid uuid:=auth.uid(); p public.profiles; a public.driver_applications; result uuid;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=uid FOR UPDATE;
 IF uid IS NULL OR NOT FOUND OR NOT p.is_active OR p.role<>'CUSTOMER' THEN
  RAISE EXCEPTION 'Кандидатстването изисква активен клиентски профил.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=p_company AND is_active) THEN RAISE EXCEPTION 'Изберете активна фирма.'; END IF;
 IF p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 2 AND 120 OR p_phone IS NULL OR length(btrim(p_phone)) NOT BETWEEN 6 AND 30
  OR p_experience IS NULL OR p_experience NOT IN ('1–3','3–5','5–10','10+') OR p_has_vehicle IS NULL OR length(coalesce(p_message,''))>500
  THEN RAISE EXCEPTION 'Проверете данните в кандидатурата.'; END IF;
 SELECT * INTO a FROM public.driver_applications WHERE user_id=uid FOR UPDATE;
 IF FOUND AND a.status='pending' THEN
  IF (a.company_id,a.full_name,a.phone,a.experience,a.has_vehicle,a.message) IS DISTINCT FROM
    (p_company,btrim(p_full_name),btrim(p_phone),p_experience,p_has_vehicle,btrim(coalesce(p_message,''))) THEN
   RAISE EXCEPTION 'Вече има изпратена кандидатура. Изчакайте решението на фирмата.'; END IF;
  RETURN a.id;
 ELSIF FOUND AND a.status='approved' THEN RAISE EXCEPTION 'Кандидатурата вече е одобрена.';
 END IF;
 INSERT INTO public.driver_applications(user_id,company_id,full_name,phone,email,experience,has_vehicle,message)
 VALUES(uid,p_company,btrim(p_full_name),btrim(p_phone),p.email,p_experience,p_has_vehicle,btrim(coalesce(p_message,'')))
 ON CONFLICT(user_id) DO UPDATE SET company_id=EXCLUDED.company_id,full_name=EXCLUDED.full_name,phone=EXCLUDED.phone,email=EXCLUDED.email,
  experience=EXCLUDED.experience,has_vehicle=EXCLUDED.has_vehicle,message=EXCLUDED.message,status='pending',review_note=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=clock_timestamp()
 RETURNING id INTO result;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(p_company,uid,'driver_application',result,'application_submitted');
 RETURN result;
END $function$
;
-- Retain the expanded document guard and read policy for files already approved through intake.
-- Their original definitions are captured in driver-onboarding-before.sql, but restoring
-- the old two-segment file guard would break renewals on newly activated drivers.
NOTIFY pgrst,'reload schema';
COMMIT;

