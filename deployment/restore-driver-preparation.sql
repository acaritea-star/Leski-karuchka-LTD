-- Restore only the verification report if onboarding needs to be rolled back.
-- Keeps accepted documents and receipts; does not erase user data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE OR REPLACE FUNCTION private.driver_verification_report(p_driver uuid, p_vehicle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
END $function$;

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
END $function$;

COMMIT;

