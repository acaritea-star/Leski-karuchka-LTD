-- New-company onboarding must work with the actual browser role and existing RLS.
-- Synthetic fixtures are rolled back; this suite runs only in the disposable DB.
BEGIN;
SET LOCAL statement_timeout='20s';
DO $test$
DECLARE
 c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); inactive_c uuid:=gen_random_uuid();
 super_uid uuid:=gen_random_uuid(); admin_uid uuid:=gen_random_uuid(); driver_uid uuid:=gen_random_uuid();
 customer_uid uuid:=gen_random_uuid(); vt uuid; inactive_vt uuid; d uuid; car uuid:=gen_random_uuid();
 denied boolean; original_tariff jsonb;
BEGIN
 INSERT INTO auth.users(id,email) SELECT id,'category-'||id||'@example.invalid'
 FROM unnest(ARRAY[super_uid,admin_uid,driver_uid,customer_uid]) x(id);
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=super_uid;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',super_uid,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO public.companies(id,name,slug,base_fare,price_per_km,price_per_minute,min_fare,dispatch_radius_km)
 VALUES(c,'Category onboarding','category-'||c,2.10,1.22,.15,0,5);
 SELECT id INTO STRICT vt FROM public.vehicle_types WHERE company_id=c AND name='Стандарт';
 IF (SELECT count(*) FROM public.vehicle_types WHERE company_id=c)<>1
  OR NOT EXISTS(SELECT 1 FROM public.vehicle_types WHERE id=vt AND capacity=4 AND multiplier=1 AND is_active)
  THEN RAISE EXCEPTION 'FAIL new company has one usable base category'; END IF;
 SELECT jsonb_build_object('base',base_fare,'km',price_per_km,'minute',price_per_minute,'min',min_fare)
 INTO original_tariff FROM public.companies WHERE id=c;
 UPDATE public.companies SET name='Updated category onboarding' WHERE id=c;
 IF (SELECT count(*) FROM public.vehicle_types WHERE company_id=c)<>1 THEN RAISE EXCEPTION 'FAIL duplicate category after company update'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=c AND base_fare=2.10 AND price_per_km=1.22 AND price_per_minute=.15 AND min_fare=0)
 THEN RAISE EXCEPTION 'FAIL category changes company fare %',original_tariff; END IF;
 -- Retry of the same company insert cannot leave a second category behind.
 INSERT INTO public.companies(id,name,slug) VALUES(c,'Retry','category-'||c) ON CONFLICT(id) DO NOTHING;
 IF (SELECT count(*) FROM public.vehicle_types WHERE company_id=c)<>1 THEN RAISE EXCEPTION 'FAIL company retry duplicates category'; END IF;
 denied:=false; BEGIN PERFORM private.seed_company_vehicle_type(); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL trigger helper is directly callable'; END IF;
 RESET ROLE;
 INSERT INTO public.companies(id,name,slug) VALUES(other_c,'Foreign category','category-'||other_c),(inactive_c,'Disabled category','category-'||inactive_c);
 SELECT id INTO STRICT inactive_vt FROM public.vehicle_types WHERE company_id=inactive_c;
 UPDATE public.vehicle_types SET is_active=false WHERE id=inactive_vt;
 UPDATE public.companies SET name='Still disabled' WHERE id=inactive_c;
 IF EXISTS(SELECT 1 FROM public.vehicle_types WHERE company_id=inactive_c AND is_active)
 THEN RAISE EXCEPTION 'FAIL company update reactivates disabled category'; END IF;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=c WHERE id=admin_uid;
 UPDATE public.profiles SET role='DRIVER',company_id=c WHERE id=driver_uid;
 SELECT id INTO STRICT d FROM public.drivers WHERE user_id=driver_uid;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.save_driver_vehicle(car,c,d,NULL,jsonb_build_object('make','Mercedes','model','CLK','registration_number','CAT-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));
 PERFORM public.save_driver_vehicle(car,c,d,NULL,jsonb_build_object('make','Mercedes','model','CLK','registration_number','CAT-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));
 IF NOT EXISTS(SELECT 1 FROM public.vehicles WHERE id=car AND company_id=c AND vehicle_type_id=vt)
  OR NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND vehicle_id=car)
 THEN RAISE EXCEPTION 'FAIL seeded category saves and assigns vehicle'; END IF;
 denied:=false; BEGIN INSERT INTO public.vehicle_types(company_id,name) VALUES(other_c,'Foreign write'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL foreign category write'; END IF;
 denied:=false; BEGIN
  PERFORM public.save_driver_vehicle(gen_random_uuid(),c,NULL,NULL,jsonb_build_object('make','Test','model','Test','registration_number','BAD','vehicle_type_id',inactive_vt));
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL inactive/foreign category assigned'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer_uid,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 denied:=false; BEGIN INSERT INTO public.companies(name,slug) VALUES('Forbidden','forbidden-'||gen_random_uuid()); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL customer creates company'; END IF;
 denied:=false; BEGIN INSERT INTO public.vehicle_types(company_id,name) VALUES(c,'Forbidden'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL customer creates category'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE anon;
 denied:=false; BEGIN INSERT INTO public.vehicle_types(company_id,name) VALUES(c,'Anonymous'); EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL anonymous category write'; END IF;
 RESET ROLE;
END $test$;
SELECT 'PASS: company category is atomic, preserves tariffs, supports vehicle assignment, and keeps role/company isolation' AS result;
ROLLBACK;
