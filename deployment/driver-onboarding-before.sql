-- Read-only checkpoint captured from production before the unified intake change.
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

CREATE OR REPLACE FUNCTION private.guard_document_file()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE owner_id uuid;
BEGIN
 -- Only approval is gated: legacy pending imports remain reviewable but cannot be approved without an actual private object.
 IF NEW.status='approved' AND (TG_OP='INSERT' OR (NEW.status,NEW.file_url,NEW.expires_at) IS DISTINCT FROM (OLD.status,OLD.file_url,OLD.expires_at)) THEN
  SELECT user_id INTO owner_id FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id;
  IF owner_id IS NULL OR NEW.file_url IS NULL OR NEW.file_url !~ ('^storage://driver-documents/'||owner_id::text||'/'||NEW.id::text||'\.(jpg|png|webp|pdf)$')
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=substr(NEW.file_url,length('storage://driver-documents/')+1)) THEN
   RAISE EXCEPTION 'Качете реалния документ в защитеното хранилище преди одобрение.'; END IF;
 END IF;
 RETURN NEW;
END $function$
;
