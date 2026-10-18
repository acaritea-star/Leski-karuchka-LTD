-- Owner-authorized draft configuration, researched 2026-10-18.
-- Requires city_company_divisions. No schema changes or role/JWT impersonation.
-- Set leski_pricing.owner_email inside this transaction before running the DO block.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15s';
-- OWNER_CONTEXT_HERE

DO $pricing$
DECLARE
 root public.companies; child public.companies; owner_id uuid; plan record;
 was_created boolean; changed integer; before_value jsonb;
 owner_email text:=lower(btrim(current_setting('leski_pricing.owner_email',true)));
BEGIN
 IF owner_email IS NULL OR owner_email='' THEN
  RAISE EXCEPTION 'Supply the verified parent owner email in leski_pricing.owner_email.';
 END IF;
 IF to_regprocedure('public.create_company_division(uuid,uuid,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Apply city_company_divisions before configuring city prices.';
 END IF;
 IF (clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date>DATE '2026-12-31' THEN
  RAISE EXCEPTION 'Review the municipal limits for the new year before applying this price plan.';
 END IF;
 SELECT c.* INTO STRICT root FROM public.companies c
 WHERE c.slug='leski-karuchka' AND c.parent_company_id IS NULL
  AND EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
   WHERE p.company_id=c.id AND p.role='COMPANY_ADMIN' AND p.is_active AND lower(u.email)=owner_email)
 FOR UPDATE OF c;
 SELECT p.id INTO STRICT owner_id FROM public.profiles p JOIN auth.users u ON u.id=p.id
 WHERE p.company_id=root.id AND p.role='COMPANY_ADMIN' AND p.is_active AND lower(u.email)=owner_email;

 -- EUR, prices inclusive of any applicable tax; standard car multiplier stays 1.
 -- The headquarters is not assigned a municipality or an operating tariff.
 FOR plan IN SELECT * FROM (VALUES
  ('Велико Търново'::text,43.0757::double precision,25.6172::double precision,1.40::numeric,0.69::numeric,1.50::numeric,0.79::numeric),
  ('Горна Оряховица'::text,43.1278::double precision,25.7017::double precision,1.30::numeric,0.65::numeric,1.50::numeric,0.75::numeric)
 ) prices(city,latitude,longitude,day_base,day_km,night_base,night_km) LOOP
  SELECT * INTO child FROM public.companies c
   WHERE c.parent_company_id=root.id AND lower(btrim(c.service_city))=lower(plan.city) FOR UPDATE;
  was_created:=NOT FOUND;
  IF NOT was_created AND (child.setup_completed_at IS NOT NULL OR child.is_active) THEN
   RAISE EXCEPTION 'The city % is already operating or configured; inspect its current tariff before overwriting it.',plan.city;
  END IF;
  before_value:=CASE WHEN was_created THEN NULL ELSE jsonb_build_object(
   'base_fare',child.base_fare,'price_per_km',child.price_per_km,'price_per_minute',child.price_per_minute,'min_fare',child.min_fare,
   'night_base_fare',child.night_base_fare,'night_price_per_km',child.night_price_per_km,
   'night_price_per_minute',child.night_price_per_minute,'night_min_fare',child.night_min_fare) END;
  IF was_created THEN
   IF (SELECT count(*) FROM public.companies WHERE parent_company_id=root.id)>=100 THEN
    RAISE EXCEPTION 'Parent division limit reached.';
   END IF;
   child.id:=gen_random_uuid();
   INSERT INTO public.companies(id,parent_company_id,name,slug,service_city,service_latitude,service_longitude,service_radius_km,
    email,phone,address,legal_name,registration_id,currency,is_active,setup_completed_at,
    document_checks_required,accepts_driver_applications,dispatch_radius_km,
    base_fare,price_per_km,price_per_minute,min_fare,
    night_base_fare,night_price_per_km,night_price_per_minute,night_min_fare)
   VALUES(child.id,root.id,root.name||' — '||plan.city,'division-'||child.id::text,
    plan.city,plan.latitude,plan.longitude,5,root.email,root.phone,root.address,root.legal_name,root.registration_id,
    'EUR',false,NULL,true,false,5,plan.day_base,plan.day_km,0,0,plan.night_base,plan.night_km,0,0)
   RETURNING * INTO child;
   changed:=1;
  ELSE
   UPDATE public.companies SET base_fare=plan.day_base,price_per_km=plan.day_km,price_per_minute=0,min_fare=0,
    night_base_fare=plan.night_base,night_price_per_km=plan.night_km,night_price_per_minute=0,night_min_fare=0
   WHERE id=child.id AND parent_company_id=root.id AND currency='EUR'
    AND ROW(base_fare,price_per_km,price_per_minute,min_fare,night_base_fare,night_price_per_km,night_price_per_minute,night_min_fare)
     IS DISTINCT FROM ROW(plan.day_base,plan.day_km,0::numeric,0::numeric,plan.night_base,plan.night_km,0::numeric,0::numeric);
   GET DIAGNOSTICS changed=ROW_COUNT;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.companies c WHERE c.id=child.id AND c.parent_company_id=root.id
   AND NOT c.is_active AND c.setup_completed_at IS NULL AND c.currency='EUR'
   AND ROW(c.base_fare,c.price_per_km,c.price_per_minute,c.min_fare,c.night_base_fare,c.night_price_per_km,c.night_price_per_minute,c.night_min_fare)
    IS NOT DISTINCT FROM ROW(plan.day_base,plan.day_km,0::numeric,0::numeric,plan.night_base,plan.night_km,0::numeric,0::numeric)) THEN
   RAISE EXCEPTION 'The saved tariff for % was not verified.',plan.city;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.vehicle_types v WHERE v.company_id=child.id AND v.service_class='standard'
   AND v.is_active AND v.multiplier=1 AND v.capacity=4) THEN
   RAISE EXCEPTION 'The standard vehicle category for % needs review.',plan.city;
  END IF;
  IF changed>0 THEN
   INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,old_value,new_value)
   VALUES(child.id,NULL,'company',child.id,'leski_launch_tariff_configured',before_value,
    jsonb_build_object('plan','2026-10-18-leski-launch.1','requested_by_profile',owner_id,
     'operator_context','owner-authorized management operation','draft_created',was_created,
     'city',plan.city,'currency','EUR','day_base',plan.day_base,'day_km',plan.day_km,
     'night_base',plan.night_base,'night_km',plan.night_km,'route_per_minute',0,'additional_minimum',0,
     'market_review','deployment/leski-launch-pricing.md'));
  END IF;
 END LOOP;
END $pricing$;
COMMIT;
