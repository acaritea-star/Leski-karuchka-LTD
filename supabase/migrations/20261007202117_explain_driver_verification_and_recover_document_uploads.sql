SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';
-- Metadata is created only by the validated registration operation.
REVOKE INSERT ON public.driver_documents FROM PUBLIC,anon,authenticated;

CREATE FUNCTION private.driver_verification_report(p_driver uuid,p_vehicle uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE d public.drivers; c public.companies; v public.vehicles; doc public.driver_documents;
 blockers jsonb:='[]'; warnings jsonb:='[]'; documents jsonb:='{}'; kind text; label text; state text;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF NOT FOUND THEN RETURN jsonb_build_object('driver_id',p_driver,'can_verify',false,'blockers',jsonb_build_array(jsonb_build_object('code','profile','message','Няма шофьорски профил.')),'warnings','[]'::jsonb,'documents','{}'::jsonb); END IF;
 SELECT * INTO c FROM public.companies WHERE id=d.company_id;
 SELECT * INTO v FROM public.vehicles WHERE id=p_vehicle AND company_id=d.company_id;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=d.user_id AND role='DRIVER' AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','profile','message','Шофьорският профил не е активен към тази фирма.')); END IF;
 IF c.id IS NULL OR NOT c.is_active THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company','message','Фирмата не е активна.')); END IF;
 IF v.id IS NULL OR NOT v.is_active OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=v.vehicle_type_id AND company_id=d.company_id AND is_active) THEN
  blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle','message','Назначете активен автомобил с активна категория от същата фирма.')); END IF;
 FOREACH kind IN ARRAY ARRAY['license','insurance'] LOOP
  label:=CASE kind WHEN 'license' THEN 'Шофьорска книжка' ELSE 'Застраховка' END;
  SELECT x.* INTO doc FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=kind
   ORDER BY (x.status='approved' AND x.expires_at>=today) DESC NULLS LAST,x.created_at DESC,x.id DESC LIMIT 1;
  state:=CASE WHEN NOT FOUND THEN 'missing' WHEN doc.expires_at IS NULL THEN 'missing_expiry'
   WHEN doc.expires_at<today THEN 'expired' WHEN doc.status='rejected' THEN 'rejected'
   WHEN doc.status<>'approved' THEN 'pending'
   WHEN NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-documents' AND doc.file_url='storage://driver-documents/'||o.name) THEN 'missing_file'
   ELSE 'approved' END;
  documents:=documents||jsonb_build_object(kind,jsonb_build_object('state',state,'expires_at',doc.expires_at));
  IF state<>'approved' THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code',kind,'message',label||': '||CASE state
   WHEN 'missing' THEN 'няма качен документ.' WHEN 'missing_expiry' THEN 'липсва срок на валидност.'
   WHEN 'expired' THEN 'срокът е изтекъл.' WHEN 'rejected' THEN 'документът е отхвърлен.'
   WHEN 'pending' THEN 'чака одобрение от фирмата.' ELSE 'защитеният файл липсва.' END)); END IF;
 END LOOP;
 IF c.permit_expires_on<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','company_permit','message','Срокът на разрешението на фирмата е изтекъл.'));
 ELSIF c.id IS NOT NULL AND c.permit_expires_on IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','company_permit','message','Не е въведен срок на разрешението на фирмата. Проверете го в „Настройки“.')); END IF;
 IF v.insurance_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Срокът на застраховката на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.insurance_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_insurance','message','Не е въведен срок на застраховката на автомобила.')); END IF;
 IF v.inspection_expiry_date<today THEN blockers:=blockers||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Срокът на техническия преглед на автомобила е изтекъл. Обновете го в „Автомобили“.'));
 ELSIF v.id IS NOT NULL AND v.inspection_expiry_date IS NULL THEN warnings:=warnings||jsonb_build_array(jsonb_build_object('code','vehicle_inspection','message','Не е въведен срок на техническия преглед на автомобила.')); END IF;
 RETURN jsonb_build_object('driver_id',d.id,'is_verified',d.is_verified,'can_verify',jsonb_array_length(blockers)=0,'blockers',blockers,'warnings',warnings,'documents',documents);
END $fn$;
REVOKE ALL ON FUNCTION private.driver_verification_report(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_verification_report(uuid,uuid) TO authenticated;

CREATE FUNCTION public.driver_verification_status(p_driver uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d public.drivers;
BEGIN
 SELECT * INTO d FROM public.drivers WHERE id=p_driver;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT(public.is_driver(d.id) OR public.is_company_admin(d.company_id) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до проверката на този шофьор.' USING ERRCODE='42501'; END IF;
 RETURN private.driver_verification_report(d.id,d.vehicle_id);
END $fn$;
REVOKE ALL ON FUNCTION public.driver_verification_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.driver_verification_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_driver_verification() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fn$
DECLARE report jsonb; reason text;
BEGIN
 -- Trusted maintenance/test fixtures do not represent a client verification action.
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND (NEW.user_id,NEW.company_id) IS DISTINCT FROM (OLD.user_id,OLD.company_id) THEN RAISE EXCEPTION 'Принадлежността на шофьора не може да се променя директно.' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND role='DRIVER' AND company_id=NEW.company_id AND is_active) THEN
   RAISE EXCEPTION 'Шофьорът трябва да има активен профил към същата фирма.'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND NEW.document_verification_required IS DISTINCT FROM OLD.document_verification_required AND NOT NEW.document_verification_required THEN
  RAISE EXCEPTION 'Проверката на документите не може да бъде изключена.' USING ERRCODE='42501'; END IF;
 IF NEW.is_verified AND (TG_OP='INSERT' OR NOT OLD.is_verified) THEN
  IF NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Нямате право да верифицирате шофьор.' USING ERRCODE='42501'; END IF;
  report:=private.driver_verification_report(NEW.id,NEW.vehicle_id);
  IF NOT (report->>'can_verify')::boolean THEN
   SELECT string_agg(item->>'message',' ') INTO reason FROM jsonb_array_elements(report->'blockers') item;
   RAISE EXCEPTION '%',reason;
  END IF;
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

CREATE OR REPLACE FUNCTION public.save_driver_vehicle(p_id uuid,p_company uuid,p_driver uuid,p_expected_driver uuid,p_details jsonb)
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
 INSERT INTO public.vehicles(id,company_id,make,model,registration_number,vehicle_type_id,year,color,capacity,is_active,insurance_expiry_date,inspection_expiry_date)
 VALUES(p_id,p_company,btrim(p_details->>'make'),btrim(p_details->>'model'),btrim(p_details->>'registration_number'),
  (p_details->>'vehicle_type_id')::uuid,nullif(p_details->>'year','')::integer,nullif(btrim(p_details->>'color'),''),coalesce((p_details->>'capacity')::integer,4),coalesce(v.is_active,true),
  CASE WHEN p_details?'insurance_expiry_date' THEN nullif(p_details->>'insurance_expiry_date','')::date ELSE v.insurance_expiry_date END,
  CASE WHEN p_details?'inspection_expiry_date' THEN nullif(p_details->>'inspection_expiry_date','')::date ELSE v.inspection_expiry_date END)
 ON CONFLICT(id) DO UPDATE SET make=EXCLUDED.make,model=EXCLUDED.model,registration_number=EXCLUDED.registration_number,
  vehicle_type_id=EXCLUDED.vehicle_type_id,year=EXCLUDED.year,color=EXCLUDED.color,capacity=EXCLUDED.capacity,insurance_expiry_date=EXCLUDED.insurance_expiry_date,inspection_expiry_date=EXCLUDED.inspection_expiry_date;
 UPDATE public.drivers SET vehicle_id=NULL WHERE vehicle_id=p_id AND id IS DISTINCT FROM p_driver;
 IF p_driver IS NOT NULL THEN UPDATE public.drivers SET vehicle_id=p_id WHERE id=p_driver; END IF;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(p_company,auth.uid(),'vehicle',p_id,'vehicle_saved',jsonb_build_object('driver_id',p_driver));
 RETURN p_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.register_driver_document(p_id uuid,p_type public.document_type,p_expires date,p_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE d public.drivers; existing public.driver_documents; uid uuid:=auth.uid(); extension text;
BEGIN
 SELECT x.* INTO d FROM public.drivers x JOIN public.profiles p ON p.id=x.user_id WHERE x.user_id=uid AND p.role='DRIVER' AND p.is_active FOR UPDATE OF x;
 IF uid IS NULL OR NOT FOUND THEN RAISE EXCEPTION 'Изисква се активен шофьорски профил.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_type IS NULL OR p_type NOT IN ('license','insurance') THEN
  RAISE EXCEPTION 'Посочете тип и валиден срок на документа.'; END IF;
 extension:=substring(p_path FROM '\.(jpg|png|webp|pdf)$');
 IF p_path IS NULL OR extension IS NULL OR p_path<>uid::text||'/'||p_id::text||'.'||extension THEN RAISE EXCEPTION 'Невалиден адрес на документ.' USING ERRCODE='42501'; END IF;
 SELECT * INTO existing FROM public.driver_documents WHERE id=p_id;
 IF FOUND THEN
  IF existing.driver_id<>d.id OR existing.type<>p_type OR existing.file_url<>'storage://driver-documents/'||p_path THEN
   RAISE EXCEPTION 'Документът вече е записан с други данни.'; END IF;
  RETURN existing.id;
 END IF;
 IF p_expires IS NULL OR p_expires<(now() AT TIME ZONE 'Europe/Sofia')::date THEN RAISE EXCEPTION 'Посочете валиден срок на документа.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=p_path) THEN
  RAISE EXCEPTION 'Файлът още не е получен. Проверете качването или изберете файла отново.'; END IF;
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at)
 VALUES(p_id,d.id,d.company_id,p_type,'storage://driver-documents/'||p_path,'pending',p_expires);
 RETURN p_id;
END $fn$;
NOTIFY pgrst,'reload schema';

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
  WHERE NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=required.type AND x.status='approved' AND x.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='driver-documents' AND x.file_url='storage://driver-documents/'||o.name)))));
$fn$;

CREATE OR REPLACE FUNCTION private.guard_document_file() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
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
END $fn$;
