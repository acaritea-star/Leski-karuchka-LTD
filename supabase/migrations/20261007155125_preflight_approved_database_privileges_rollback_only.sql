-- Preflight only: inner subtransaction rolls back ALL grants, fixtures and DDL.
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='60s';
DO $preflight$
DECLARE before_acl jsonb; after_acl jsonb; obj record; priv text; failures integer:=0;
BEGIN
 SELECT jsonb_build_object('tables',(SELECT jsonb_object_agg(c.oid::text,to_jsonb(c.relacl)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres'))) INTO before_acl;
 BEGIN
 -- Defense in depth: RLS does not cover TRUNCATE/REFERENCES.
-- Keep SELECT grants (public news and other read policies) and authenticated DML.
-- Extension-owned PostGIS objects require Supabase owner-level remediation.
DO $grants$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM PUBLIC, anon', obj.nspname, obj.relname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM authenticated', obj.nspname, obj.relname);
  END LOOP;
END $grants$;
-- Defaults for new application tables created by future postgres migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
NOTIFY pgrst, 'reload schema';
 FOR obj IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
 LOOP
  FOREACH priv IN ARRAY ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('anon',format('%I.%I',obj.nspname,obj.relname),priv) THEN RAISE EXCEPTION 'Anonymous % remains on %',priv,obj.relname; END IF;
  END LOOP;
  FOREACH priv IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
   IF has_table_privilege('authenticated',format('%I.%I',obj.nspname,obj.relname),priv) THEN RAISE EXCEPTION 'Authenticated % remains on %',priv,obj.relname; END IF;
  END LOOP;
 END LOOP;
 CREATE TABLE public.__leski_privilege_probe(id integer);
 IF has_table_privilege('anon','public.__leski_privilege_probe','INSERT')
 OR has_table_privilege('authenticated','public.__leski_privilege_probe','TRUNCATE')
 OR NOT has_table_privilege('anon','public.__leski_privilege_probe','SELECT')
 OR NOT has_table_privilege('authenticated','public.__leski_privilege_probe','INSERT')
 THEN RAISE EXCEPTION 'Incorrect default privileges'; END IF;
 BEGIN
 EXECUTE $onboarding$
-- Role-level integration regression. Only synthetic rows, no real files, emails or API calls.
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 c uuid:=gen_random_uuid(); other_c uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid();
 admin_id uuid:=gen_random_uuid(); foreign_admin uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 application uuid; d uuid; vt uuid:=gen_random_uuid(); car uuid:=gen_random_uuid();
 license uuid:=gen_random_uuid(); insurance uuid:=gen_random_uuid(); fake uuid:=gen_random_uuid(); quote uuid:=gen_random_uuid(); ride uuid:=gen_random_uuid();
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date; denied boolean; count_rows integer; stmt text; obj_path text;
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(c,'Verification fixture','verify-'||c),(other_c,'Foreign verification fixture','verify-'||other_c);
 INSERT INTO auth.users(id,email) SELECT id,'verify-'||id||'@example.invalid' FROM unnest(ARRAY[candidate,admin_id,foreign_admin,customer]) s(id);
 UPDATE public.profiles SET company_id=c WHERE id IN (candidate,customer);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=c WHERE id=admin_id;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=other_c WHERE id=foreign_admin;
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(vt,c,'Verification fixture');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 application:=public.submit_driver_application(c,'Test Driver','+359000000000','1–3',false,'Synthetic');
 IF public.submit_driver_application(c,'Test Driver','+359000000000','1–3',false,'Synthetic')<>application THEN RAISE EXCEPTION 'FAIL application idempotency'; END IF;
 IF jsonb_array_length(public.export_my_basic_data()->'driver_applications')<>1 THEN RAISE EXCEPTION 'FAIL application privacy export'; END IF;
 denied:=false;BEGIN PERFORM public.review_driver_application(application,'approved','Self');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL candidate self-approval'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_admin,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.driver_applications WHERE id=application) THEN RAISE EXCEPTION 'FAIL foreign application read'; END IF;
 denied:=false;BEGIN PERFORM public.review_driver_application(application,'approved','Foreign');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL foreign review'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.review_driver_application(application,'approved','Checked applicant');
 PERFORM public.review_driver_application(application,'approved','Lost response retry');
 SELECT id INTO STRICT d FROM public.drivers WHERE user_id=candidate;
 IF EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND (is_verified OR is_online OR NOT document_verification_required)) THEN RAISE EXCEPTION 'FAIL enrollment grants dispatch'; END IF;
 denied:=false;BEGIN UPDATE public.drivers SET is_verified=true WHERE id=d;EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL verify without vehicle/documents'; END IF;
 PERFORM public.save_driver_vehicle(car,c,d,NULL,jsonb_build_object('make','Test','model','Fixture','registration_number','V-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND vehicle_id=car) THEN RAISE EXCEPTION 'FAIL vehicle assignment'; END IF;
 -- Idempotent same-ID retry does not create another vehicle.
 PERFORM public.save_driver_vehicle(car,c,d,NULL,jsonb_build_object('make','Test','model','Fixture','registration_number','V-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 FOREACH stmt IN ARRAY ARRAY[
  format('UPDATE public.drivers SET is_verified=true WHERE id=%L',d),
  format('SELECT public.register_driver_document(%L,''license'',%L,%L)',fake,today+30,candidate||'/'||fake||'.pdf'),
  format('INSERT INTO storage.objects(bucket_id,name) VALUES(''driver-documents'',%L)',customer||'/'||fake||'.pdf')
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected candidate denial: %',stmt; END IF;
 END LOOP;
 INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at) VALUES(d,c,43.2,25.6,10,clock_timestamp());
 denied:=false;BEGIN UPDATE public.drivers SET is_online=true WHERE id=d;EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL unverified online'; END IF;
 -- Object metadata fixtures test policy/registration only; no HTTP upload is claimed.
 obj_path:=candidate||'/'||license||'.pdf';
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('driver-documents',obj_path,candidate::text,'{"mimetype":"application/pdf","size":100}');
 PERFORM public.register_driver_document(license,'license',today+30,obj_path);
 PERFORM public.register_driver_document(license,'license',today+30,obj_path);
 obj_path:=candidate||'/'||insurance||'.pdf';
 INSERT INTO storage.objects(bucket_id,name,owner_id,metadata) VALUES('driver-documents',obj_path,candidate::text,'{"mimetype":"application/pdf","size":100}');
 PERFORM public.register_driver_document(insurance,'insurance',today+30,obj_path);
 IF (SELECT count(*) FROM public.driver_documents WHERE driver_id=d)<>2 THEN RAISE EXCEPTION 'FAIL document idempotency'; END IF;
 UPDATE public.driver_documents SET status='approved' WHERE id=license;
 GET DIAGNOSTICS count_rows=ROW_COUNT;
 IF count_rows<>0 THEN RAISE EXCEPTION 'FAIL driver document self-approval'; END IF;
 UPDATE storage.objects SET name=candidate||'/'||fake||'.pdf' WHERE bucket_id='driver-documents' AND name=obj_path;
 GET DIAGNOSTICS count_rows=ROW_COUNT;
 IF count_rows<>0 THEN RAISE EXCEPTION 'FAIL mutable upload'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_admin,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.driver_documents WHERE driver_id=d) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name LIKE candidate||'/%') THEN RAISE EXCEPTION 'FAIL foreign document disclosure'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='driver-documents' AND name LIKE candidate||'/%')<>2 THEN RAISE EXCEPTION 'FAIL admin private file visibility'; END IF;
 denied:=false;BEGIN UPDATE public.driver_documents SET status='approved',expires_at=today-1 WHERE id=license;EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL expired approval'; END IF;
 UPDATE public.driver_documents SET status='approved' WHERE driver_id=d;
 IF (SELECT count(*) FROM public.driver_documents WHERE driver_id=d AND reviewed_by=admin_id AND reviewed_at IS NOT NULL)<>2 THEN RAISE EXCEPTION 'FAIL review provenance'; END IF;
 UPDATE public.drivers SET is_verified=true WHERE id=d;
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND is_verified AND document_verification_required) THEN RAISE EXCEPTION 'FAIL admin verification'; END IF;
 denied:=false;BEGIN UPDATE public.drivers SET document_verification_required=false WHERE id=d;EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL disable verification checks'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.drivers SET is_online=true WHERE id=d;
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND is_online) THEN RAISE EXCEPTION 'FAIL verified driver online'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.driver_documents SET status='rejected' WHERE id=insurance;
 IF private.driver_documents_ready(d) THEN RAISE EXCEPTION 'FAIL revoked document dispatch'; END IF;
 UPDATE public.driver_documents SET status='approved' WHERE id=insurance;
 RESET ROLE;
 -- Revocation must stop future dispatch without trapping the passenger in an active trip.
 INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 VALUES(quote,customer,c,vt,'{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Verification fixture","destination_address":"Verification fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.create_taxi_request(quote,ride,'cash');
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.accept_taxi_request(ride);
 UPDATE public.taxi_requests SET status='arrived' WHERE id=ride;
 UPDATE public.taxi_requests SET status='in_progress' WHERE id=ride;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 denied:=false;BEGIN PERFORM public.save_driver_vehicle(car,c,NULL,d,jsonb_build_object('make','Test','model','Fixture','registration_number','V-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL assignment during active trip'; END IF;
 UPDATE public.drivers SET is_verified=false WHERE id=d;
 RESET ROLE;
 IF EXISTS(SELECT 1 FROM private.eligible_drivers(c,vt,43.2,25.6) WHERE driver_id=d) THEN RAISE EXCEPTION 'FAIL revoked driver eligible'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 UPDATE public.taxi_requests SET status='completed' WHERE id=ride;
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND status='completed') THEN RAISE EXCEPTION 'FAIL completion after revocation'; END IF;
 IF EXISTS(SELECT 1 FROM private.eligible_drivers(c,vt,43.2,25.6) WHERE driver_id=d) THEN RAISE EXCEPTION 'FAIL revoked driver eligible after completion'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_id,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.save_driver_vehicle(car,c,NULL,d,jsonb_build_object('make','Test','model','Fixture','registration_number','V-'||left(car::text,8),'vehicle_type_id',vt,'capacity',4));
 IF EXISTS(SELECT 1 FROM public.drivers WHERE id=d AND vehicle_id=car) THEN RAISE EXCEPTION 'FAIL vehicle unassignment'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE anon;
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name LIKE candidate||'/%') THEN RAISE EXCEPTION 'FAIL anonymous private file'; END IF;
 denied:=false;BEGIN PERFORM public.review_driver_application(application,'approved','Anon');EXCEPTION WHEN insufficient_privilege THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL anonymous RPC'; END IF;
 RESET ROLE;
 IF (SELECT count(*) FROM public.audit_log WHERE entity_id=d AND action IN ('driver_verified','driver_unverified'))<>2 THEN RAISE EXCEPTION 'FAIL verification audit'; END IF;
 PERFORM set_config('leski.driver_test',jsonb_build_object('passed',true,'application','isolated and idempotent','documents','private, immutable, reviewed','verification','server enforced','vehicle','atomic assignment and unassignment')::text,true);
END $test$;
SELECT current_setting('leski.driver_test')::jsonb AS result;

$onboarding$;
 RAISE EXCEPTION USING ERRCODE='PZ002', MESSAGE='suite_success_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
 END;
BEGIN
 EXECUTE $rides$
-- Bounded smoke test, synthetic UUIDs, no DDL, no Google calls, no committed data.
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $test$
DECLARE
 company uuid:=gen_random_uuid(); vehicle_type uuid:=gen_random_uuid();
 customer uuid; driver_user uuid; driver uuid; vehicle uuid; other_customer uuid:=gen_random_uuid();
 quote uuid; request uuid; result public.taxi_requests; preview jsonb;
 i integer; k integer; n integer; visible_count integer; denied boolean;
 started timestamptz:=clock_timestamp();
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(company,'Audit fixture','audit-fixture-'||company);
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(vehicle_type,company,'Audit fixture');
 INSERT INTO auth.users(id,email) VALUES(other_customer,'audit-'||other_customer||'@example.invalid');
 UPDATE public.profiles SET company_id=company WHERE id=other_customer;
 FOR i IN 1..5 LOOP
  customer:=gen_random_uuid(); driver_user:=gen_random_uuid(); vehicle:=gen_random_uuid();
  INSERT INTO auth.users(id,email) SELECT id,'audit-'||id||'@example.invalid' FROM unnest(ARRAY[customer,driver_user]) s(id);
  UPDATE public.profiles SET company_id=company WHERE id=customer;
  UPDATE public.profiles SET company_id=company,role='DRIVER' WHERE id=driver_user;
  SELECT d.id INTO STRICT driver FROM public.drivers d WHERE d.user_id=driver_user;
  INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
   VALUES(vehicle,company,vehicle_type,'Audit','Fixture','AUDIT-'||vehicle);
  INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
   VALUES(driver,company,43.2,25.6,10,clock_timestamp());
  UPDATE public.drivers SET document_verification_required=false WHERE id=driver;
UPDATE public.drivers SET vehicle_id=vehicle,is_verified=true,is_online=true WHERE id=driver;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
  FOR k IN 1..20 LOOP
   SET LOCAL ROLE authenticated;
   INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
    VALUES(driver,company,43.2+k*.000001,25.6,10,clock_timestamp())
    ON CONFLICT(driver_id) DO UPDATE SET latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,
     accuracy=EXCLUDED.accuracy,position_at=EXCLUDED.position_at;
   RESET ROLE;
  END LOOP;
  FOR n IN 1..3 LOOP
   quote:=gen_random_uuid(); request:=gen_random_uuid();
   INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
    VALUES(quote,customer,company,vehicle_type,
     '{"pickup_latitude":43.2,"pickup_longitude":25.6,"destination_latitude":43.21,"destination_longitude":25.61,"pickup_address":"Audit fixture","destination_address":"Audit fixture","distance_km":2,"duration_min":5,"total":5,"breakdown":{"total":5}}');
   PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   result:=public.create_taxi_request(quote,request,'cash');
   IF result.id<>request OR (public.create_taxi_request(quote,request,'cash')).id<>request THEN RAISE EXCEPTION 'FAIL create/retry identity'; END IF;
   RESET ROLE;
   PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
   -- One request proves that a far-away or expired offer cannot be taken.
   IF i=1 AND n=1 THEN
    SET LOCAL ROLE authenticated;
    UPDATE public.driver_locations SET latitude=42.6977,longitude=23.3219,position_at=clock_timestamp() WHERE driver_id=driver;
    denied:=false;
    BEGIN
     PERFORM public.accept_taxi_request(request);
    EXCEPTION WHEN OTHERS THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL cross-city acceptance'; END IF;
    UPDATE public.driver_locations SET latitude=43.2,longitude=25.6,position_at=clock_timestamp() WHERE driver_id=driver;
    RESET ROLE;
    UPDATE public.taxi_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=request;
    SET LOCAL ROLE authenticated;
    denied:=false;
    BEGIN
     PERFORM public.accept_taxi_request(request);
    EXCEPTION WHEN OTHERS THEN denied:=true;
    END;
    IF NOT denied THEN RAISE EXCEPTION 'FAIL expired acceptance'; END IF;
    RESET ROLE;
    UPDATE public.taxi_requests SET expires_at=clock_timestamp()+interval '2 minutes' WHERE id=request;
   END IF;
   SET LOCAL ROLE authenticated;
   result:=public.accept_taxi_request(request);
   IF result.driver_id<>driver OR (public.accept_taxi_request(request)).driver_id<>driver THEN RAISE EXCEPTION 'FAIL accept/retry identity'; END IF;
   RESET ROLE;
   PERFORM set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true);
   SET LOCAL ROLE authenticated;
   SELECT count(*) INTO visible_count FROM public.taxi_requests WHERE id=request;
   RESET ROLE;
   IF visible_count<>0 THEN RAISE EXCEPTION 'FAIL isolation'; END IF;
   IF n=2 THEN
    PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE public.taxi_requests SET status='cancelled',cancel_reason='audit_fixture' WHERE id=request;
    RESET ROLE;
    IF EXISTS(SELECT 1 FROM public.trips WHERE request_id=request) THEN RAISE EXCEPTION 'FAIL cancelled trip counted'; END IF;
   ELSE
    PERFORM set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true);
    SET LOCAL ROLE authenticated;
    UPDATE public.taxi_requests SET status='arrived' WHERE id=request;
    UPDATE public.taxi_requests SET status='in_progress' WHERE id=request;
    UPDATE public.taxi_requests SET status='completed',final_price=99999 WHERE id=request;
    RESET ROLE;
    IF (SELECT count(*) FROM public.trips WHERE request_id=request)<>1
     OR (SELECT final_price FROM public.taxi_requests WHERE id=request)<>5 THEN RAISE EXCEPTION 'FAIL completion integrity'; END IF;
   END IF;
   IF (SELECT count(*) FROM public.request_outcomes WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'FAIL outcome cardinality'; END IF;
  END LOOP;
 END LOOP;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 preview:=public.nearby_cars(43.2,25.6,vehicle_type);
 RESET ROLE;
 IF jsonb_array_length(preview->'cars')<>5 THEN RAISE EXCEPTION 'FAIL available car count'; END IF;
 IF preview->'cars'->0 ? 'driver_id' THEN RAISE EXCEPTION 'FAIL nearby identity disclosure'; END IF;
 IF (SELECT count(*) FROM public.taxi_requests WHERE company_id=company AND status='completed')<>10
  OR (SELECT count(*) FROM public.taxi_requests WHERE company_id=company AND status='cancelled')<>5
  OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE company_id=company AND status IN ('pending','accepted','arrived','in_progress'))
  OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=company) THEN RAISE EXCEPTION 'FAIL final accounting'; END IF;
 PERFORM set_config('leski.audit_result',jsonb_build_object('passed',true,'drivers',5,'gps_updates',102,'gps_seed_rows',5,'cross_city_blocked',true,'expired_blocked',true,
  'completed',10,'cancelled',5,'ms',round(extract(epoch FROM clock_timestamp()-started)*1000,2))::text,true);
END $test$;
SELECT current_setting('leski.audit_result')::jsonb AS result;

$rides$;
 RAISE EXCEPTION USING ERRCODE='PZ002', MESSAGE='suite_success_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
 END;
BEGIN
 EXECUTE $accounting$
-- Standalone regression: synthetic users and records only; always ROLLBACK.
-- No network calls, Google APIs, emails or permanent test accounts.
DO $test$
DECLARE
 cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid();
 duid uuid:=gen_random_uuid(); admin_uid uuid:=gen_random_uuid(); foreign_uid uuid:=gen_random_uuid();
 super_uid uuid:=gen_random_uuid(); customer_uid uuid:=gen_random_uuid(); did uuid;
 vt uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); ride uuid:=gen_random_uuid();
 license uuid:=gen_random_uuid(); insurance uuid:=gen_random_uuid(); renewal uuid:=gen_random_uuid();
 income uuid:=gen_random_uuid(); confirmation uuid:=gen_random_uuid(); acceptance uuid; ticket uuid; review_time timestamptz;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date; result jsonb; stmt text; denied boolean; row_count integer;
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(cid,'PWA regression','pwa-'||cid),(foreign_cid,'Other regression','pwa-'||foreign_cid);
 INSERT INTO auth.users(id,email) SELECT id,'pwa-'||id||'@example.invalid' FROM unnest(ARRAY[duid,admin_uid,foreign_uid,super_uid,customer_uid]) s(id);
 UPDATE public.profiles SET role='DRIVER',company_id=cid WHERE id=duid;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=cid WHERE id=admin_uid;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=foreign_cid WHERE id=foreign_uid;
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=super_uid;
 SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(vt,cid,'PWA test');
 INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number) VALUES(vehicle,cid,vt,'Test','Test','PWA-'||left(vehicle::text,8));
 UPDATE public.drivers SET vehicle_id=vehicle,is_verified=true WHERE id=did;
 INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at) VALUES(did,cid,43.2,25.6,10,now());
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
  destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,completed_at,estimated_price,final_price)
 VALUES(ride,cid,customer_uid,did,vt,43.2,25.6,'Synthetic',43.21,25.61,'Synthetic','in_progress',now()-interval '10 minutes',now()-interval '8 minutes',NULL,20,NULL);
 UPDATE public.taxi_requests SET status='completed',completed_at=clock_timestamp(),final_price=20 WHERE id=ride;

 INSERT INTO storage.objects(bucket_id,name,owner_id) SELECT 'driver-documents',duid||'/'||id||'.pdf',duid::text FROM unnest(ARRAY[license,insurance,renewal]) t(id);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 acceptance:=public.accept_legal_versions('2026-10-03-draft.2','2026-10-04.2','continue');
 IF public.accept_legal_versions('2026-10-03-draft.2','2026-10-04.2','continue')<>acceptance THEN RAISE EXCEPTION 'FAIL duplicate acceptance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE id=acceptance AND user_id=duid AND length(source_digest)=64 AND accepted_at BETWEEN now()-interval '1 minute' AND clock_timestamp()) THEN RAISE EXCEPTION 'FAIL server acceptance provenance'; END IF;
 FOREACH stmt IN ARRAY ARRAY[
  'SELECT public.accept_legal_versions(''old'',''old'',''continue'')',
  'SELECT public.accept_legal_versions(''2026-10-03-draft.2'',''2026-10-04.2'',''advertising'')',
  'DELETE FROM public.legal_acceptances',
  format('SELECT private.record_driver_money_core(%L,''income'',10,''Bypass'')',gen_random_uuid()),
  format('SELECT public.record_driver_money_verified(%L,''income'',10,''Wrong account'',%L)',gen_random_uuid(),admin_uid)
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected rejection: %',stmt;END IF;
 END LOOP;
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at,reviewed_at,reviewed_by)
 VALUES(license,did,cid,'license','storage://driver-documents/'||duid||'/'||license||'.pdf','approved',today+30,now(),admin_uid);
 IF NOT EXISTS(SELECT 1 FROM public.driver_documents WHERE id=license AND status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) THEN RAISE EXCEPTION 'FAIL forged driver approval'; END IF;
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at)
 VALUES(insurance,did,cid,'insurance','storage://driver-documents/'||duid||'/'||insurance||'.pdf','pending',today+30);
 IF public.record_driver_money_verified(income,'income',12.50,'Measured cash',duid,ride)<>income THEN RAISE EXCEPTION 'FAIL income';END IF;
 PERFORM public.record_driver_money_verified(income,'income',12.50,'Measured cash',duid,ride);
 ticket:=public.request_personal_data('deletion');
 IF public.request_personal_data('deletion')<>ticket THEN RAISE EXCEPTION 'FAIL duplicate open privacy request'; END IF;
 result:=public.export_my_basic_data();
 IF result#>>'{profile,id}'<>duid::text OR jsonb_array_length(result->'money_entries')<>1 OR jsonb_array_length(result->'requests')<>0 THEN RAISE EXCEPTION 'FAIL basic export scope';END IF;
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.legal_acceptances WHERE user_id=duid) OR EXISTS(SELECT 1 FROM public.privacy_requests WHERE user_id=duid) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=cid) THEN RAISE EXCEPTION 'FAIL foreign read'; END IF;
 FOREACH stmt IN ARRAY ARRAY[
  format('SELECT public.record_driver_money_verified(%L,''confirmation'',0,''Foreign'',%L,NULL,%L,''receipt'',''R-1'')',gen_random_uuid(),foreign_uid,income),
  format('SELECT public.resolve_privacy_request(%L,''completed'',''Forbidden'')',ticket)
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected foreign rejection: %',stmt;END IF;
 END LOOP;
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH stmt IN ARRAY ARRAY[
  format('SELECT public.record_driver_money(%L,''confirmation'',0,''No proof'',NULL,%L)',gen_random_uuid(),income),
  format('SELECT public.record_driver_money_verified(%L,''confirmation'',0,''No proof'',%L,NULL,%L)',gen_random_uuid(),admin_uid,income),
  format('SELECT public.record_driver_money_verified(%L,''confirmation'',0,''No reference'',%L,NULL,%L,''receipt'')',gen_random_uuid(),admin_uid,income),
  format('UPDATE public.companies SET legal_verified_at=clock_timestamp() WHERE id=%L',cid),
  format('UPDATE public.driver_documents SET status=''approved'',expires_at=NULL WHERE id=%L',license)
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected proof rejection: %',stmt;END IF;
 END LOOP;
 PERFORM public.record_driver_money_verified(confirmation,'confirmation',0,'Checked cash book',admin_uid,NULL,income,'cash_book','TEST-1');
 PERFORM public.record_driver_money_verified(confirmation,'confirmation',0,'Checked cash book',admin_uid,NULL,income,'cash_book','TEST-1');
 result:=public.accounting_report(today,today+1,cid);
 IF (result#>>'{finances,confirmed_income}')::numeric<>12.50 OR (result#>>'{finances,income}')::numeric<>12.50
  OR jsonb_array_length(result->'reconciliation')<>1 OR (result#>>'{reconciliation,0,difference}')::numeric<>-7.50
  OR (result#>>'{reconciliation,0,company_confirmed}')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL reconciliation %',result;END IF;
 UPDATE public.driver_documents SET status='approved' WHERE id=license;
 SELECT reviewed_at INTO review_time FROM public.driver_documents WHERE id=license;
 UPDATE public.driver_documents SET reviewed_by=foreign_uid,reviewed_at='2000-01-01' WHERE id=license;
 IF NOT EXISTS(SELECT 1 FROM public.driver_documents WHERE id=license AND reviewed_by=admin_uid AND reviewed_at=review_time) THEN RAISE EXCEPTION 'FAIL review provenance spoof';END IF;
 UPDATE public.driver_documents SET status='approved' WHERE id=insurance;
 UPDATE public.companies SET document_checks_required=true,legal_name='Synthetic Ltd',registration_id='123456789',address='Synthetic',permit_number='TEST',permit_expires_on=today+30 WHERE id=cid;
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 UPDATE public.drivers SET is_online=true WHERE id=did;
 UPDATE public.drivers SET is_online=false WHERE id=did;
 denied:=false;BEGIN PERFORM public.record_driver_money_verified(gen_random_uuid(),'reversal',0,'Reverse confirmed',duid,NULL,income);EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL reversed verified income';END IF;
 EXECUTE 'RESET ROLE';
 -- Simulate time passing without changing production clocks or real documents.
 UPDATE public.driver_documents SET expires_at=today-1 WHERE id=insurance;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 denied:=false;BEGIN UPDATE public.drivers SET is_online=true WHERE id=did;EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL expired document dispatch';END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at)
 VALUES(renewal,did,cid,'insurance','storage://driver-documents/'||duid||'/'||renewal||'.pdf','pending',today+30);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 UPDATE public.driver_documents SET status='approved' WHERE id=renewal;
 IF NOT private.driver_documents_ready(did) THEN RAISE EXCEPTION 'FAIL renewed document';END IF;
 UPDATE public.companies SET permit_expires_on=today-1 WHERE id=cid;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 denied:=false;BEGIN UPDATE public.drivers SET is_online=true WHERE id=did;EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL expired carrier permit dispatch';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.companies SET permit_expires_on=today+30 WHERE id=cid;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',super_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 INSERT INTO public.companies(id,name,slug,legal_name,registration_id,address,permit_number,permit_expires_on,legal_verified_at,legal_verified_by)
 VALUES(gen_random_uuid(),'Verified insertion regression','pwa-insert-'||cid,'Synthetic insertion Ltd','987654321','Synthetic','TEST',today+30,'2099-01-01',foreign_uid);
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE slug='pwa-insert-'||cid AND legal_verified_by=super_uid AND legal_verified_at BETWEEN now()-interval '1 minute' AND clock_timestamp()) THEN RAISE EXCEPTION 'FAIL carrier insert provenance';END IF;
 UPDATE public.companies SET legal_verified_at='2099-01-01',legal_verified_by=foreign_uid WHERE id=cid;
 IF NOT EXISTS(SELECT 1 FROM public.companies WHERE id=cid AND legal_verified_by=super_uid AND legal_verified_at BETWEEN now()-interval '1 minute' AND clock_timestamp()) THEN RAISE EXCEPTION 'FAIL carrier provenance';END IF;
 PERFORM public.resolve_privacy_request(ticket,'completed','Synthetic regression: processing simulated inside rollback only');
 IF NOT EXISTS(SELECT 1 FROM public.privacy_requests WHERE id=ticket AND status='completed' AND resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'FAIL privacy completion';END IF;
 denied:=false;BEGIN PERFORM public.resolve_privacy_request(ticket,'rejected','Rewrite closed');EXCEPTION WHEN OTHERS THEN denied:=true;END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL closed privacy request rewrite';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 UPDATE public.companies SET legal_name='Changed synthetic name' WHERE id=cid;
 IF EXISTS(SELECT 1 FROM public.companies WHERE id=cid AND (legal_verified_at IS NOT NULL OR legal_verified_by IS NOT NULL)) THEN RAISE EXCEPTION 'FAIL changed carrier retains verification';END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 FOREACH stmt IN ARRAY ARRAY[
  'SELECT public.accept_legal_versions(''2026-10-03-draft.2'',''2026-10-04.2'',''continue'')',
  'SELECT public.export_my_basic_data()', 'SELECT public.request_personal_data(''export'')',
  'SELECT * FROM public.legal_acceptances','SELECT * FROM public.privacy_requests'
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected anonymous rejection: %',stmt;END IF;
 END LOOP;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO row_count FROM public.driver_money_entries WHERE company_id=cid;
 IF row_count<>2 THEN RAISE EXCEPTION 'FAIL duplicate ledger entries';END IF;
END $test$;
SELECT 'PASS: versioned acceptance; evidence/idempotency; reconciliation; owner/company/anon isolation; protected carrier/document provenance; expiry and renewal; privacy workflow and basic export' AS result;

$accounting$;
 RAISE EXCEPTION USING ERRCODE='PZ002', MESSAGE='suite_success_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ002' THEN NULL;
 END;
 -- No test notification or data escapes the subtransaction.
 RAISE EXCEPTION USING ERRCODE='PZ001', MESSAGE='preflight_success_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL;
 END;
 SELECT jsonb_build_object('tables',(SELECT jsonb_object_agg(c.oid::text,to_jsonb(c.relacl)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),'defaults',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.oid) FROM pg_default_acl d WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres'))) INTO after_acl;
 IF before_acl IS DISTINCT FROM after_acl THEN RAISE EXCEPTION 'Privilege preflight did not restore original ACLs'; END IF;
 IF to_regclass('public.__leski_privilege_probe') IS NOT NULL OR EXISTS(SELECT 1 FROM public.companies WHERE slug LIKE 'verify-%' OR slug LIKE 'audit-fixture-%' OR slug LIKE 'pwa-%') THEN RAISE EXCEPTION 'Preflight fixtures remain'; END IF;
END $preflight$;
