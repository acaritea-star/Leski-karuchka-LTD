-- Existing verified drivers retain access; new enrollments require reviewed documents.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.drivers ADD COLUMN document_verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.drivers ALTER COLUMN document_verification_required SET DEFAULT true;

CREATE TABLE public.driver_applications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 full_name text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
 phone text NOT NULL CHECK (length(phone) BETWEEN 6 AND 30),
 email text,
 experience text NOT NULL CHECK (experience IN ('1–3','3–5','5–10','10+')),
 has_vehicle boolean NOT NULL,
 message text NOT NULL DEFAULT '' CHECK (length(message)<=500),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
 review_note text CHECK (length(review_note)<=500),
 reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_applications_company_status_idx ON public.driver_applications(company_id,status,created_at);
CREATE INDEX driver_applications_reviewer_idx ON public.driver_applications(reviewed_by) WHERE reviewed_by IS NOT NULL;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_applications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.driver_applications TO authenticated;
CREATE POLICY applications_read ON public.driver_applications FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR public.is_company_admin(company_id) OR public.is_super_admin());

CREATE FUNCTION public.submit_driver_application(p_company uuid,p_full_name text,p_phone text,p_experience text,p_has_vehicle boolean,p_message text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION public.submit_driver_application(uuid,text,text,text,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_driver_application(uuid,text,text,text,boolean,text) TO authenticated;

CREATE FUNCTION public.review_driver_application(p_id uuid,p_decision text,p_note text DEFAULT '')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
END $fn$;
REVOKE ALL ON FUNCTION public.review_driver_application(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_driver_application(uuid,text,text) TO authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('driver-documents','driver-documents',false,5242880,ARRAY['image/jpeg','image/png','image/webp','application/pdf']);
CREATE FUNCTION private.can_read_driver_document(p_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE d.user_id::text=split_part(p_name,'/',1)
 AND ((d.user_id=auth.uid() AND p.is_active AND p.role='DRIVER') OR public.is_company_admin(d.company_id) OR public.is_super_admin()));
$fn$;
REVOKE ALL ON FUNCTION private.can_read_driver_document(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.can_read_driver_document(text) TO authenticated;
CREATE POLICY driver_documents_files_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='driver-documents' AND private.can_read_driver_document(name));
CREATE POLICY driver_documents_files_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='driver-documents' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text
 AND name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'
 AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=(SELECT auth.uid()) AND public.is_driver(d.id)));
-- No public access, overwrite or client delete. Retention/deletion is an administrator workflow.

CREATE FUNCTION public.register_driver_document(p_id uuid,p_type public.document_type,p_expires date,p_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d public.drivers; existing public.driver_documents; uid uuid:=auth.uid(); extension text;
BEGIN
 SELECT x.* INTO d FROM public.drivers x JOIN public.profiles p ON p.id=x.user_id WHERE x.user_id=uid AND p.role='DRIVER' AND p.is_active FOR UPDATE OF x;
 IF uid IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Изисква се активен шофьорски профил.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('license','insurance') OR p_expires IS NULL OR p_expires<(now() AT TIME ZONE 'Europe/Sofia')::date THEN
  RAISE EXCEPTION 'Посочете тип и валиден срок на документа.'; END IF;
 extension:=substring(p_path FROM '\.(jpg|png|webp|pdf)$');
 IF p_path IS NULL OR extension IS NULL OR p_path<>uid::text||'/'||p_id::text||'.'||extension THEN RAISE EXCEPTION 'Невалиден адрес на документ.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=p_path) THEN
  RAISE EXCEPTION 'Файлът още не е получен. Проверете качването или изберете файла отново.'; END IF;
 SELECT * INTO existing FROM public.driver_documents WHERE id=p_id;
 IF FOUND THEN
  IF existing.driver_id<>d.id OR existing.type<>p_type OR existing.expires_at IS DISTINCT FROM p_expires OR existing.file_url<>'storage://driver-documents/'||p_path THEN
   RAISE EXCEPTION 'Документът вече е записан с други данни.'; END IF;
  RETURN existing.id;
 END IF;
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at)
 VALUES(p_id,d.id,d.company_id,p_type,'storage://driver-documents/'||p_path,'pending',p_expires);
 RETURN p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.register_driver_document(uuid,public.document_type,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_driver_document(uuid,public.document_type,date,text) TO authenticated;

CREATE FUNCTION private.guard_document_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE owner_id uuid;
BEGIN
 -- Only approval is gated: legacy pending imports remain reviewable but cannot be approved without an actual private object.
 IF NEW.status='approved' AND (TG_OP='INSERT' OR (NEW.status,NEW.file_url,NEW.expires_at) IS DISTINCT FROM (OLD.status,OLD.file_url,OLD.expires_at)) THEN
  SELECT user_id INTO owner_id FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id;
  IF owner_id IS NULL OR NEW.file_url IS NULL OR NEW.file_url NOT LIKE 'storage://driver-documents/'||owner_id::text||'/%'
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=substr(NEW.file_url,length('storage://driver-documents/')+1)) THEN
   RAISE EXCEPTION 'Качете реалния документ в защитеното хранилище преди одобрение.'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.guard_document_file() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER zz_guard_document_file BEFORE INSERT OR UPDATE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.guard_document_file();

CREATE OR REPLACE FUNCTION private.driver_documents_ready(p_driver uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.companies c ON c.id=d.company_id LEFT JOIN public.vehicles v ON v.id=d.vehicle_id
 WHERE d.id=p_driver
 AND (c.permit_expires_on IS NULL OR c.permit_expires_on>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND (v.insurance_expiry_date IS NULL OR v.insurance_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND (v.inspection_expiry_date IS NULL OR v.inspection_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type IN ('license','insurance') AND x.status='approved'
  AND x.expires_at<(now() AT TIME ZONE 'Europe/Sofia')::date
  AND NOT EXISTS(SELECT 1 FROM public.driver_documents y WHERE y.driver_id=d.id AND y.type=x.type AND y.status='approved' AND y.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))
 AND (NOT(c.document_checks_required OR d.document_verification_required) OR NOT EXISTS(
  SELECT 1 FROM unnest(ARRAY['license','insurance']) required(type)
  WHERE NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=required.type AND x.status='approved' AND x.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))));
$fn$;

CREATE FUNCTION private.guard_driver_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 -- Trusted maintenance/test fixtures do not represent a client verification action.
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR (NEW.user_id,NEW.company_id) IS DISTINCT FROM (OLD.user_id,OLD.company_id) THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND role='DRIVER' AND company_id=NEW.company_id AND is_active) THEN
   RAISE EXCEPTION 'Шофьорът трябва да има активен профил към същата фирма.'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.document_verification_required IS DISTINCT FROM OLD.document_verification_required AND NOT NEW.document_verification_required THEN
  RAISE EXCEPTION 'Проверката на документите не може да бъде изключена.' USING ERRCODE='42501'; END IF;
 IF NEW.is_verified AND (TG_OP='INSERT' OR NOT OLD.is_verified) THEN
  IF NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Нямате право да верифицирате шофьор.' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vehicles v JOIN public.vehicle_types t ON t.id=v.vehicle_type_id AND t.company_id=v.company_id AND t.is_active
    JOIN public.companies c ON c.id=v.company_id AND c.is_active WHERE v.id=NEW.vehicle_id AND v.company_id=NEW.company_id AND v.is_active) THEN
   RAISE EXCEPTION 'Първо назначете активен автомобил с активна категория от същата фирма.'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['license','insurance']) required(type) WHERE NOT EXISTS(
   SELECT 1 FROM public.driver_documents x WHERE x.driver_id=NEW.id AND x.type::text=required.type AND x.status='approved' AND x.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))
   OR NOT private.driver_documents_ready(NEW.id) THEN RAISE EXCEPTION 'Първо одобрете валидни книжка и застраховка и проверете сроковете на фирмата и автомобила.'; END IF;
  NEW.document_verification_required:=true;
 END IF;
 IF TG_OP='UPDATE' AND NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id THEN
  IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE driver_id=NEW.id AND status IN ('accepted','arrived','in_progress')) THEN
   RAISE EXCEPTION 'Автомобилът не може да се сменя по време на активен курс.'; END IF;
  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=NEW.vehicle_id AND company_id=NEW.company_id AND is_active) THEN
   RAISE EXCEPTION 'Изберете активен автомобил от същата фирма.'; END IF;
 END IF;
 IF NEW.is_online AND (TG_OP='INSERT' OR NOT OLD.is_online) AND NOT NEW.is_verified THEN
  RAISE EXCEPTION 'Профилът очаква верификация от администратор.'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.guard_driver_verification() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_driver_verification BEFORE INSERT OR UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_driver_verification();

NOTIFY pgrst,'reload schema';

-- Vehicle details and assignment must commit together, including unassignment.
CREATE FUNCTION public.save_driver_vehicle(p_id uuid,p_company uuid,p_driver uuid,p_expected_driver uuid,p_details jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v public.vehicles; assigned uuid; target public.drivers;
BEGIN
 IF auth.uid() IS NULL OR NOT(public.is_company_admin(p_company) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате права за тази фирма.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.companies WHERE id=p_company FOR UPDATE;
 SELECT * INTO v FROM public.vehicles WHERE id=p_id FOR UPDATE;
 IF FOUND AND v.company_id<>p_company THEN RAISE EXCEPTION 'Автомобилът е от друга фирма.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_details IS NULL OR length(btrim(coalesce(p_details->>'make',''))) NOT BETWEEN 1 AND 80
  OR length(btrim(coalesce(p_details->>'model',''))) NOT BETWEEN 1 AND 80
  OR length(btrim(coalesce(p_details->>'registration_number',''))) NOT BETWEEN 1 AND 30
  OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=(p_details->>'vehicle_type_id')::uuid AND company_id=p_company AND is_active)
  THEN RAISE EXCEPTION 'Проверете автомобила, регистрационния номер и активната категория.'; END IF;
 PERFORM 1 FROM public.drivers WHERE vehicle_id=p_id OR id=p_driver ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM public.drivers WHERE vehicle_id=p_id)>1 THEN RAISE EXCEPTION 'Повече от един шофьор е свързан с автомобила. Нужна е проверка от администратор.'; END IF;
 SELECT id INTO assigned FROM public.drivers WHERE vehicle_id=p_id;
 IF assigned IS DISTINCT FROM p_expected_driver AND assigned IS DISTINCT FROM p_driver THEN
  RAISE EXCEPTION 'Назначението е променено от друг администратор. Обновете списъка.'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_requests r JOIN public.drivers d ON d.id=r.driver_id
  WHERE (d.vehicle_id=p_id OR d.id=p_driver) AND r.status IN ('accepted','arrived','in_progress')) THEN
  RAISE EXCEPTION 'Изчакайте активният курс да приключи, преди да променяте автомобила.'; END IF;
 IF p_driver IS NOT NULL THEN
  SELECT d.* INTO target FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id AND p.is_active AND p.role='DRIVER'
  WHERE d.id=p_driver AND d.company_id=p_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'Изберете активен шофьор от същата фирма.'; END IF;
 END IF;
 INSERT INTO public.vehicles(id,company_id,make,model,registration_number,vehicle_type_id,year,color,capacity,is_active)
 VALUES(p_id,p_company,btrim(p_details->>'make'),btrim(p_details->>'model'),btrim(p_details->>'registration_number'),
  (p_details->>'vehicle_type_id')::uuid,nullif(p_details->>'year','')::integer,nullif(btrim(p_details->>'color'),''),coalesce((p_details->>'capacity')::integer,4),coalesce(v.is_active,true))
 ON CONFLICT(id) DO UPDATE SET make=EXCLUDED.make,model=EXCLUDED.model,registration_number=EXCLUDED.registration_number,
  vehicle_type_id=EXCLUDED.vehicle_type_id,year=EXCLUDED.year,color=EXCLUDED.color,capacity=EXCLUDED.capacity;
 UPDATE public.drivers SET vehicle_id=NULL WHERE vehicle_id=p_id AND id IS DISTINCT FROM p_driver;
 IF p_driver IS NOT NULL THEN UPDATE public.drivers SET vehicle_id=p_id WHERE id=p_driver; END IF;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(p_company,auth.uid(),'vehicle',p_id,'vehicle_saved',jsonb_build_object('driver_id',p_driver));
 RETURN p_id;
END $fn$;
REVOKE ALL ON FUNCTION public.save_driver_vehicle(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_driver_vehicle(uuid,uuid,uuid,uuid,jsonb) TO authenticated;
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
 'privacy_requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.privacy_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'money_entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_money_entries WHERE driver_user_id=uid ORDER BY recorded_at DESC LIMIT 1000)x),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,created_at,pickup_address,destination_address,estimated_price FROM public.taxi_requests WHERE customer_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $function$
