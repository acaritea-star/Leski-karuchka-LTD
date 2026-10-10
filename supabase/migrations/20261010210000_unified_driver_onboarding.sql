-- Candidate intake does not grant DRIVER access. Activation is one audited transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
ALTER TABLE public.driver_applications ADD COLUMN onboarding_required boolean NOT NULL DEFAULT false,
 ADD COLUMN onboarding_revision integer NOT NULL DEFAULT 0,
 ADD COLUMN submitted_at timestamptz,
 ADD COLUMN vehicle_details jsonb;
ALTER TABLE public.driver_applications ALTER COLUMN onboarding_required SET DEFAULT true;
ALTER TABLE public.driver_applications ADD CONSTRAINT application_vehicle_size CHECK(vehicle_details IS NULL OR
 (jsonb_typeof(vehicle_details)='object' AND octet_length(vehicle_details::text)<=5000));

CREATE TABLE public.driver_application_documents (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES public.driver_applications(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id),
 type public.document_type NOT NULL CHECK(type IN ('license','insurance','vehicle_registration')),
 expires_at date, file_url text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(type='vehicle_registration' OR expires_at IS NOT NULL)
);
CREATE INDEX application_documents_latest ON public.driver_application_documents(application_id,company_id,type,created_at DESC,id DESC);
CREATE INDEX application_documents_user ON public.driver_application_documents(user_id);
CREATE INDEX application_documents_company ON public.driver_application_documents(company_id);
CREATE TABLE public.driver_application_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid NOT NULL REFERENCES public.driver_applications(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, company_id uuid NOT NULL REFERENCES public.companies(id),
 terms_version text NOT NULL, training_version text NOT NULL, content_hash text NOT NULL,
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(), training_completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(application_id,company_id,terms_version,training_version),
 FOREIGN KEY(terms_version,training_version) REFERENCES private.driver_policy_versions(terms_version,training_version)
);
CREATE INDEX application_acceptances_user ON public.driver_application_acceptances(user_id);
CREATE INDEX application_acceptances_company ON public.driver_application_acceptances(company_id);
CREATE INDEX application_acceptances_version ON public.driver_application_acceptances(terms_version,training_version);
ALTER TABLE public.driver_application_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_application_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_application_documents,public.driver_application_acceptances FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.driver_application_documents,public.driver_application_acceptances TO authenticated,service_role;
CREATE POLICY application_documents_read ON public.driver_application_documents FOR SELECT TO authenticated USING(
 user_id=(SELECT auth.uid()) OR public.is_company_admin(company_id) OR public.is_super_admin());
CREATE POLICY application_acceptances_read ON public.driver_application_acceptances FOR SELECT TO authenticated USING(
 user_id=(SELECT auth.uid()) OR public.is_company_admin(company_id) OR public.is_super_admin());

CREATE FUNCTION private.application_file_access(p_name text,p_write boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT p_name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' AND EXISTS(
 SELECT 1 FROM public.driver_applications a JOIN public.profiles p ON p.id=a.user_id
 WHERE a.id::text=split_part(p_name,'/',2) AND a.user_id::text=split_part(p_name,'/',1)
 AND (NOT p_write OR (a.status='pending' AND p.is_active AND p.role='CUSTOMER'))
 AND ((a.user_id=auth.uid() AND p.is_active) OR public.is_super_admin() OR
 (public.is_company_admin(a.company_id) AND (p_write OR EXISTS(
  SELECT 1 FROM public.driver_application_documents x WHERE x.application_id=a.id AND x.company_id=a.company_id
   AND x.file_url='storage://driver-documents/'||p_name))))));
$fn$;
REVOKE ALL ON FUNCTION private.application_file_access(text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.application_file_access(text,boolean) TO authenticated;
CREATE POLICY application_files_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='driver-documents' AND private.application_file_access(name,true));
CREATE POLICY application_files_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='driver-documents' AND private.application_file_access(name,false));

CREATE FUNCTION private.driver_onboarding(p_application uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications; v private.driver_policy_versions; receipt public.driver_application_acceptances; docs jsonb;
BEGIN
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(a.user_id=auth.uid() OR public.is_company_admin(a.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до тази подготовка.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Профилът е неактивен.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT v FROM private.driver_policy_versions WHERE is_current;
 SELECT * INTO receipt FROM public.driver_application_acceptances WHERE application_id=a.id AND user_id=a.user_id AND company_id=a.company_id
  AND terms_version=v.terms_version AND training_version=v.training_version AND content_hash=v.content_hash;
 SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO docs FROM (
  SELECT DISTINCT ON(type) * FROM public.driver_application_documents WHERE application_id=a.id AND company_id=a.company_id
  ORDER BY type,created_at DESC,id DESC)x;
 RETURN jsonb_build_object('application',to_jsonb(a),'company_name',(SELECT name FROM public.companies WHERE id=a.company_id),
  'documents',docs,'preparation',jsonb_build_object('document',v.document,'content_hash',v.content_hash,
  'receipt',CASE WHEN receipt.id IS NULL THEN NULL ELSE to_jsonb(receipt) END));
END $fn$;
CREATE FUNCTION public.driver_onboarding(p_application uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.driver_onboarding(p_application); $fn$;

CREATE FUNCTION private.accept_application_preparation(p_application uuid,p_terms text,p_training text,p_hash text,p_answers jsonb,p_general_terms text,p_general_privacy text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications; v private.driver_policy_versions; r public.driver_application_acceptances; general_id uuid;
BEGIN
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application AND user_id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR a.status<>'pending' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=a.user_id AND is_active AND role='CUSTOMER') THEN
  RAISE EXCEPTION 'Само кандидатът може да приеме своите условия.' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT v FROM private.driver_policy_versions WHERE is_current FOR SHARE;
 IF (p_terms,p_training,p_hash) IS DISTINCT FROM (v.terms_version,v.training_version,v.content_hash) OR p_answers IS DISTINCT FROM v.answers THEN
  RAISE EXCEPTION 'Прочети текущите условия и провери трите отговора. Не всички са верни или версията е обновена.' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.legal_versions WHERE is_current AND terms_version=p_general_terms AND privacy_version=p_general_privacy) THEN
  RAISE EXCEPTION 'Общите условия са обновени. Обнови приложението.' USING ERRCODE='22023'; END IF;
 general_id:=private.accept_legal_versions(p_general_terms,p_general_privacy,'continue');
 INSERT INTO public.driver_application_acceptances(application_id,user_id,company_id,terms_version,training_version,content_hash)
 VALUES(a.id,a.user_id,a.company_id,v.terms_version,v.training_version,v.content_hash) ON CONFLICT DO NOTHING;
 IF FOUND THEN UPDATE public.driver_applications SET onboarding_revision=onboarding_revision+1,submitted_at=NULL WHERE id=a.id; END IF;
 SELECT * INTO STRICT r FROM public.driver_application_acceptances WHERE application_id=a.id AND company_id=a.company_id AND terms_version=v.terms_version AND training_version=v.training_version;
 RETURN to_jsonb(r)||jsonb_build_object('general_acceptance_id',general_id);
END $fn$;
CREATE FUNCTION public.accept_application_preparation(p_application uuid,p_terms text,p_training text,p_hash text,p_answers jsonb,p_general_terms text,p_general_privacy text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.accept_application_preparation(p_application,p_terms,p_training,p_hash,p_answers,p_general_terms,p_general_privacy); $fn$;

CREATE FUNCTION private.register_application_document(p_application uuid,p_id uuid,p_type public.document_type,p_expires date,p_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications; x public.driver_application_documents; ext text; admin_upload boolean;
BEGIN
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(a.user_id=auth.uid() OR public.is_company_admin(a.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до документите.' USING ERRCODE='42501'; END IF;
 admin_upload:=a.user_id<>auth.uid();
 IF NOT private.application_file_access(p_path,true) OR p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('license','insurance','vehicle_registration') THEN
  RAISE EXCEPTION 'Невалиден документ или профил.' USING ERRCODE='42501'; END IF;
 ext:=substring(p_path FROM '\.(jpg|png|webp|pdf)$');
 IF ext IS NULL OR p_path<>a.user_id::text||'/'||a.id::text||'/'||p_id::text||'.'||ext THEN RAISE EXCEPTION 'Невалиден адрес.' USING ERRCODE='42501'; END IF;
 SELECT * INTO x FROM public.driver_application_documents WHERE id=p_id;
 IF FOUND THEN
  IF (x.application_id,x.company_id,x.type,x.expires_at,x.file_url) IS DISTINCT FROM
   (a.id,a.company_id,p_type,p_expires,'storage://driver-documents/'||p_path) THEN RAISE EXCEPTION 'Документът е записан с други данни.'; END IF;
  RETURN x.id;
 END IF;
 IF (p_type<>'vehicle_registration' AND (p_expires IS NULL OR p_expires<(now() AT TIME ZONE 'Europe/Sofia')::date)) OR
  (p_type='vehicle_registration' AND p_expires IS NOT NULL) THEN RAISE EXCEPTION 'Проверете срока на документа.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=p_path) THEN RAISE EXCEPTION 'Файлът още не е получен. Провери качването.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.driver_application_acceptances r JOIN private.driver_policy_versions v USING(terms_version,training_version)
  WHERE r.application_id=a.id AND r.company_id=a.company_id AND v.is_current AND r.content_hash=v.content_hash) THEN
  RAISE EXCEPTION 'Първо кандидатът трябва да завърши подготовката.'; END IF;
 INSERT INTO public.driver_application_documents(id,application_id,user_id,company_id,type,expires_at,file_url)
 VALUES(p_id,a.id,a.user_id,a.company_id,p_type,p_expires,'storage://driver-documents/'||p_path);
 UPDATE public.driver_applications SET onboarding_revision=onboarding_revision+1,
  submitted_at=CASE WHEN admin_upload AND NOT a.has_vehicle AND p_type='insurance' THEN submitted_at ELSE NULL END WHERE id=a.id;
 RETURN p_id;
END $fn$;
CREATE FUNCTION public.register_application_document(p_application uuid,p_id uuid,p_type public.document_type,p_expires date,p_path text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.register_application_document(p_application,p_id,p_type,p_expires,p_path); $fn$;

CREATE FUNCTION private.save_application_vehicle(p_application uuid,p_has_vehicle boolean,p_details jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications; today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application AND user_id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR a.status<>'pending' OR p_has_vehicle IS NULL OR
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=a.user_id AND is_active AND role='CUSTOMER') THEN RAISE EXCEPTION 'Нямате права за тази кандидатура.' USING ERRCODE='42501'; END IF;
 IF p_has_vehicle AND (p_details IS NULL OR jsonb_typeof(p_details)<>'object' OR octet_length(p_details::text)>5000 OR
  length(btrim(coalesce(p_details->>'make',''))) NOT BETWEEN 1 AND 80 OR length(btrim(coalesce(p_details->>'model',''))) NOT BETWEEN 1 AND 80 OR
  length(btrim(coalesce(p_details->>'registration_number',''))) NOT BETWEEN 1 AND 30 OR
  nullif(p_details->>'insurance_expiry_date','') IS NULL OR nullif(p_details->>'inspection_expiry_date','') IS NULL OR
  (p_details->>'insurance_expiry_date')::date<today OR (p_details->>'inspection_expiry_date')::date<today) THEN
  RAISE EXCEPTION 'Попълни марка, модел, регистрация и валидни срокове на застраховката и прегледа.'; END IF;
 IF (a.has_vehicle,a.vehicle_details) IS DISTINCT FROM (p_has_vehicle,CASE WHEN p_has_vehicle THEN p_details ELSE NULL END) THEN
  UPDATE public.driver_applications SET has_vehicle=p_has_vehicle,vehicle_details=CASE WHEN p_has_vehicle THEN p_details ELSE NULL END,
   onboarding_revision=onboarding_revision+1,submitted_at=NULL WHERE id=a.id;
 END IF;
 RETURN a.id;
END $fn$;
CREATE FUNCTION public.save_application_vehicle(p_application uuid,p_has_vehicle boolean,p_details jsonb) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.save_application_vehicle(p_application,p_has_vehicle,p_details); $fn$;

CREATE FUNCTION private.check_application_package(p_application uuid,p_for_activation boolean) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE a public.driver_applications; kind text; x public.driver_application_documents; today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 SELECT * INTO STRICT a FROM public.driver_applications WHERE id=p_application;
 IF NOT EXISTS(SELECT 1 FROM public.driver_application_acceptances r JOIN private.driver_policy_versions v USING(terms_version,training_version)
  WHERE r.application_id=a.id AND r.user_id=a.user_id AND r.company_id=a.company_id AND v.is_current AND r.content_hash=v.content_hash) THEN
  RAISE EXCEPTION 'Кандидатът трябва лично да приеме текущите условия и да премине подготовката.'; END IF;
 IF a.has_vehicle AND a.vehicle_details IS NULL THEN RAISE EXCEPTION 'Липсват данните за собствения автомобил.'; END IF;
 FOREACH kind IN ARRAY CASE WHEN a.has_vehicle THEN ARRAY['license','insurance','vehicle_registration']
  WHEN p_for_activation THEN ARRAY['license','insurance'] ELSE ARRAY['license'] END LOOP
  SELECT * INTO x FROM public.driver_application_documents WHERE application_id=a.id AND company_id=a.company_id AND type::text=kind ORDER BY created_at DESC,id DESC LIMIT 1;
  IF NOT FOUND OR (kind<>'vehicle_registration' AND (x.expires_at IS NULL OR x.expires_at<today)) OR
   NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND x.file_url='storage://driver-documents/'||name) THEN
   RAISE EXCEPTION 'Липсва валиден, качен документ: %.',CASE kind WHEN 'license' THEN 'шофьорска книжка' WHEN 'insurance' THEN 'застраховка' ELSE 'регистрация на автомобила' END; END IF;
  IF a.has_vehicle AND kind='insurance' AND x.expires_at IS DISTINCT FROM (a.vehicle_details->>'insurance_expiry_date')::date THEN
   RAISE EXCEPTION 'Срокът на застраховката в документа и автомобила се различава.'; END IF;
 END LOOP;
END $fn$;
REVOKE ALL ON FUNCTION private.check_application_package(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.submit_driver_onboarding(p_application uuid,p_revision integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications;
BEGIN
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application AND user_id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR a.status<>'pending' OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=a.user_id AND is_active AND role='CUSTOMER') THEN
  RAISE EXCEPTION 'Нямате права за тази кандидатура.' USING ERRCODE='42501'; END IF;
 IF p_revision IS NULL OR p_revision<>a.onboarding_revision THEN RAISE EXCEPTION 'Пакетът е променен. Обнови го преди изпращане.' USING ERRCODE='40001'; END IF;
 PERFORM private.check_application_package(a.id,false);
 UPDATE public.driver_applications SET submitted_at=coalesce(submitted_at,clock_timestamp()) WHERE id=a.id;
 RETURN a.id;
END $fn$;
CREATE FUNCTION public.submit_driver_onboarding(p_application uuid,p_revision integer) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.submit_driver_onboarding(p_application,p_revision); $fn$;

CREATE FUNCTION private.verify_driver_application(p_application uuid,p_revision integer,p_vehicle uuid,p_category uuid,p_checks_confirmed boolean,p_note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.driver_applications; p public.profiles; d public.drivers; car public.vehicles; doc public.driver_application_documents;
 r public.driver_application_acceptances; v private.driver_policy_versions; car_id uuid; report jsonb; reason text;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date; pinned_company uuid;
BEGIN
 -- Company -> profile -> application -> vehicle/driver order agrees with vehicle save.
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_company_admin(a.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате права да верифицирате този кандидат.' USING ERRCODE='42501'; END IF;
 pinned_company:=a.company_id;
 PERFORM 1 FROM public.companies WHERE id=pinned_company FOR UPDATE;
 SELECT * INTO p FROM public.profiles WHERE id=a.user_id FOR UPDATE;
 SELECT * INTO a FROM public.driver_applications WHERE id=p_application FOR UPDATE;
 IF a.company_id IS DISTINCT FROM pinned_company THEN RAISE EXCEPTION 'Фирмата в кандидатурата е променена. Обновете пакета.' USING ERRCODE='40001'; END IF;
 IF a.status='approved' THEN
  SELECT * INTO d FROM public.drivers WHERE user_id=a.user_id AND company_id=a.company_id;
  IF d.is_verified THEN RETURN d.id; END IF;
  RAISE EXCEPTION 'Кандидатурата вече е одобрена. Прегледайте шофьорския профил.';
 END IF;
 IF a.status<>'pending' OR a.submitted_at IS NULL OR NOT a.onboarding_required THEN RAISE EXCEPTION 'Изчакайте кандидатът да изпрати целия пакет.'; END IF;
 IF p_revision IS NULL OR p_revision<>a.onboarding_revision THEN RAISE EXCEPTION 'Пакетът е променен след прегледа. Обновете го.' USING ERRCODE='40001'; END IF;
 IF p_checks_confirmed IS DISTINCT FROM true OR length(coalesce(p_note,''))>500 THEN RAISE EXCEPTION 'Потвърдете проверката на документите и приложимите разрешения.'; END IF;
 IF NOT p.is_active OR p.role<>'CUSTOMER' OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=p.id) THEN RAISE EXCEPTION 'Профилът е променен или неактивен.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=a.company_id AND is_active AND permit_expires_on>=today) THEN
  RAISE EXCEPTION 'Попълнете валидния срок на разрешението на фирмата в Настройки.'; END IF;
 IF EXISTS(SELECT 1 FROM public.taxi_requests WHERE customer_id=p.id AND status IN ('pending','accepted','arrived','in_progress')) THEN
  RAISE EXCEPTION 'Кандидатът има незавършена клиентска заявка.'; END IF;
 PERFORM private.check_application_package(a.id,true);
 SELECT * INTO STRICT v FROM private.driver_policy_versions WHERE is_current FOR SHARE;
 SELECT * INTO STRICT r FROM public.driver_application_acceptances WHERE application_id=a.id AND company_id=a.company_id
  AND terms_version=v.terms_version AND training_version=v.training_version AND content_hash=v.content_hash;
 IF a.has_vehicle THEN
  IF p_vehicle IS NOT NULL OR p_category IS NULL OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=p_category AND company_id=a.company_id AND is_active) THEN RAISE EXCEPTION 'Изберете активна категория за собствения автомобил.'; END IF;
  IF EXISTS(SELECT 1 FROM public.vehicles WHERE company_id=a.company_id AND upper(btrim(registration_number))=upper(btrim(a.vehicle_details->>'registration_number'))) THEN
   RAISE EXCEPTION 'Автомобил с тази регистрация вече е добавен. Проверете го преди активиране.'; END IF;
  IF (a.vehicle_details->>'insurance_expiry_date')::date<today OR (a.vehicle_details->>'inspection_expiry_date')::date<today THEN RAISE EXCEPTION 'Сроковете на автомобила са изтекли.'; END IF;
  car_id:=gen_random_uuid();
  INSERT INTO public.vehicles(id,company_id,make,model,registration_number,vehicle_type_id,insurance_expiry_date,inspection_expiry_date)
  VALUES(car_id,a.company_id,btrim(a.vehicle_details->>'make'),btrim(a.vehicle_details->>'model'),upper(btrim(a.vehicle_details->>'registration_number')),p_category,
   (a.vehicle_details->>'insurance_expiry_date')::date,(a.vehicle_details->>'inspection_expiry_date')::date);
 ELSE
  SELECT * INTO car FROM public.vehicles WHERE id=p_vehicle AND company_id=a.company_id FOR UPDATE;
  IF NOT FOUND OR NOT car.is_active OR car.insurance_expiry_date IS NULL OR car.insurance_expiry_date<today OR
   car.inspection_expiry_date IS NULL OR car.inspection_expiry_date<today OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=car.vehicle_type_id AND company_id=a.company_id AND is_active) THEN
   RAISE EXCEPTION 'Изберете активен автомобил от фирмата с валидна застраховка, преглед и категория.'; END IF;
  IF EXISTS(SELECT 1 FROM public.drivers WHERE vehicle_id=car.id) THEN RAISE EXCEPTION 'Автомобилът вече е назначен на друг шофьор.'; END IF;
  SELECT * INTO STRICT doc FROM public.driver_application_documents WHERE application_id=a.id AND company_id=a.company_id AND type='insurance' ORDER BY created_at DESC,id DESC LIMIT 1;
  IF doc.expires_at IS DISTINCT FROM car.insurance_expiry_date THEN RAISE EXCEPTION 'Срокът на качената застраховка не съвпада с автомобила.'; END IF;
  car_id:=car.id;
 END IF;
 UPDATE public.profiles SET role='DRIVER',company_id=a.company_id,phone=a.phone,first_name=split_part(a.full_name,' ',1),
  last_name=btrim(substr(a.full_name,length(split_part(a.full_name,' ',1))+1)) WHERE id=a.user_id;
 SELECT * INTO STRICT d FROM public.drivers WHERE user_id=a.user_id FOR UPDATE;
 INSERT INTO public.driver_preparation_acceptances(driver_id,user_id,company_id,terms_version,training_version,content_hash,accepted_at,training_completed_at)
 VALUES(d.id,a.user_id,a.company_id,r.terms_version,r.training_version,r.content_hash,r.accepted_at,r.training_completed_at);
 FOR doc IN SELECT DISTINCT ON(type) * FROM public.driver_application_documents WHERE application_id=a.id AND company_id=a.company_id ORDER BY type,created_at DESC,id DESC LOOP
  INSERT INTO public.driver_documents(id,driver_id,company_id,type,expires_at,file_url,status,reviewed_by,reviewed_at)
  VALUES(doc.id,d.id,a.company_id,doc.type,doc.expires_at,doc.file_url,'approved',auth.uid(),clock_timestamp());
 END LOOP;
 -- SECURITY DEFINER bypasses invoker triggers: explicitly call the same full report before verification.
 report:=private.driver_verification_report(d.id,car_id);
 IF NOT (report->>'can_verify')::boolean THEN
  SELECT string_agg(x->>'message',' ') INTO reason FROM jsonb_array_elements(report->'blockers')x; RAISE EXCEPTION '%',reason; END IF;
 UPDATE public.drivers SET vehicle_id=car_id,is_verified=true,is_online=false,status='offline',document_verification_required=true WHERE id=d.id;
 UPDATE public.driver_applications SET status='approved',reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=btrim(coalesce(p_note,'')) WHERE id=a.id;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(a.company_id,auth.uid(),'driver_application',a.id,'application_verified',jsonb_build_object('driver_id',d.id,'vehicle_id',car_id,
  'revision',a.onboarding_revision,'checks_confirmed',true,'preparation_receipt',r.id,'note',btrim(coalesce(p_note,''))));
 RETURN d.id;
END $fn$;
CREATE FUNCTION public.verify_driver_application(p_application uuid,p_revision integer,p_vehicle uuid,p_category uuid,p_checks_confirmed boolean,p_note text DEFAULT '')
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.verify_driver_application(p_application,p_revision,p_vehicle,p_category,p_checks_confirmed,p_note); $fn$;

CREATE OR REPLACE FUNCTION private.guard_document_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE owner_id uuid; candidate_path boolean;
BEGIN
 IF NEW.status='approved' AND (TG_OP='INSERT' OR (NEW.status,NEW.file_url,NEW.expires_at) IS DISTINCT FROM (OLD.status,OLD.file_url,OLD.expires_at)) THEN
  SELECT user_id INTO owner_id FROM public.drivers WHERE id=NEW.driver_id AND company_id=NEW.company_id;
  candidate_path:=EXISTS(SELECT 1 FROM public.driver_application_documents x WHERE x.id=NEW.id AND x.user_id=owner_id
   AND x.company_id=NEW.company_id AND x.file_url=NEW.file_url AND x.type=NEW.type);
  IF owner_id IS NULL OR NEW.file_url IS NULL OR
   (NEW.file_url !~ ('^storage://driver-documents/'||owner_id::text||'/'||NEW.id::text||'\.(jpg|png|webp|pdf)$') AND NOT candidate_path)
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=substr(NEW.file_url,length('storage://driver-documents/')+1)) THEN
   RAISE EXCEPTION 'Качете реалния документ в защитеното хранилище преди одобрение.'; END IF;
 END IF;
 RETURN NEW;
END $fn$;

REVOKE ALL ON FUNCTION private.driver_onboarding(uuid),public.driver_onboarding(uuid),
 private.accept_application_preparation(uuid,text,text,text,jsonb,text,text),public.accept_application_preparation(uuid,text,text,text,jsonb,text,text),
 private.register_application_document(uuid,uuid,public.document_type,date,text),public.register_application_document(uuid,uuid,public.document_type,date,text),
 private.save_application_vehicle(uuid,boolean,jsonb),public.save_application_vehicle(uuid,boolean,jsonb),
 private.submit_driver_onboarding(uuid,integer),public.submit_driver_onboarding(uuid,integer),
 private.verify_driver_application(uuid,integer,uuid,uuid,boolean,text),public.verify_driver_application(uuid,integer,uuid,uuid,boolean,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.driver_onboarding(uuid),public.driver_onboarding(uuid),
 private.accept_application_preparation(uuid,text,text,text,jsonb,text,text),public.accept_application_preparation(uuid,text,text,text,jsonb,text,text),
 private.register_application_document(uuid,uuid,public.document_type,date,text),public.register_application_document(uuid,uuid,public.document_type,date,text),
 private.save_application_vehicle(uuid,boolean,jsonb),public.save_application_vehicle(uuid,boolean,jsonb),
 private.submit_driver_onboarding(uuid,integer),public.submit_driver_onboarding(uuid,integer),
 private.verify_driver_application(uuid,integer,uuid,uuid,boolean,text),public.verify_driver_application(uuid,integer,uuid,uuid,boolean,text)
 TO authenticated;
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
 IF p_decision='approved' AND a.onboarding_required THEN RAISE EXCEPTION 'Прегледайте целия пакет и използвайте „Одобри и верифицирай“.'; END IF;
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
 'driver_application_documents',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_application_documents WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'driver_application_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_application_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $function$
;
NOTIFY pgrst,'reload schema';
COMMIT;
