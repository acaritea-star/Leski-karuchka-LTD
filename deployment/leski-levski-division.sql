-- Owner-authorized Levski draft; no operating tariff is assumed.
-- Supply the verified owner email at OWNER_CONTEXT_HERE, inside this transaction.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
-- OWNER_CONTEXT_HERE

DO $division$
DECLARE
 parent public.companies; child public.companies; owner_id uuid;
 owner_email text:=lower(btrim(current_setting('leski_pricing.owner_email',true)));
BEGIN
 IF owner_email IS NULL OR owner_email='' THEN
  RAISE EXCEPTION 'Supply the verified parent owner email.';
 END IF;
 SELECT c.* INTO STRICT parent FROM public.companies c
 WHERE c.slug='leski-karuchka' AND c.parent_company_id IS NULL
  AND EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
   WHERE p.company_id=c.id AND p.role='COMPANY_ADMIN' AND p.is_active AND lower(u.email)=owner_email)
 FOR UPDATE OF c;
 SELECT p.id INTO STRICT owner_id FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.company_id=parent.id AND p.role='COMPANY_ADMIN' AND p.is_active AND lower(u.email)=owner_email;
 SELECT c.* INTO child FROM public.companies c
 WHERE c.parent_company_id=parent.id AND lower(btrim(c.service_city))=lower('Левски') FOR UPDATE;
 -- Repeating this operation never overwrites a city's later setup or prices.
 IF FOUND THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.companies WHERE parent_company_id=parent.id)>=100 THEN
  RAISE EXCEPTION 'Parent division limit reached.';
 END IF;
 child.id:=gen_random_uuid();
 INSERT INTO public.companies(id,parent_company_id,name,slug,service_city,service_latitude,service_longitude,service_radius_km,
  email,phone,address,legal_name,registration_id,currency,is_active,setup_completed_at,
  document_checks_required,accepts_driver_applications,dispatch_radius_km,
  base_fare,price_per_km,price_per_minute,min_fare,
  night_base_fare,night_price_per_km,night_price_per_minute,night_min_fare)
 VALUES(child.id,parent.id,parent.name||' — Левски','division-'||child.id::text,'Левски',43.3592,25.1358,5,
  parent.email,parent.phone,parent.address,parent.legal_name,parent.registration_id,'EUR',false,NULL,true,false,5,
  0,0,0,0,NULL,NULL,NULL,NULL)
 RETURNING * INTO child;
 IF NOT EXISTS(SELECT 1 FROM public.vehicle_types v WHERE v.company_id=child.id AND v.service_class='standard'
  AND v.is_active AND v.multiplier=1 AND v.capacity=4) THEN
  RAISE EXCEPTION 'The standard vehicle category needs review.';
 END IF;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(child.id,NULL,'company',child.id,'leski_levski_draft_created',jsonb_build_object(
  'requested_by_profile',owner_id,'operator_context','owner-authorized management operation',
  'city','Левски','parent_company_id',parent.id,'tariff_status','awaiting_local_tariff_review',
  'service_radius_km',5,'permit_copied',false));
END $division$;
COMMIT;
