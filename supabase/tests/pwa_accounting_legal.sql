-- Standalone regression: synthetic users and records only; always ROLLBACK.
-- No network calls, Google APIs, emails or permanent test accounts.
BEGIN;
DO $test$
DECLARE
 cid uuid:=gen_random_uuid(); foreign_cid uuid:=gen_random_uuid();
 duid uuid:=gen_random_uuid(); admin_uid uuid:=gen_random_uuid(); foreign_uid uuid:=gen_random_uuid();
 super_uid uuid:=gen_random_uuid(); customer_uid uuid:=gen_random_uuid(); did uuid;
 vt uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); ride uuid:=gen_random_uuid();
 license uuid:=gen_random_uuid(); insurance uuid:=gen_random_uuid(); renewal uuid:=gen_random_uuid();
 income uuid:=gen_random_uuid(); confirmation uuid:=gen_random_uuid(); acceptance uuid; ticket uuid; review_time timestamptz;
 today date:=(now() AT TIME ZONE 'Europe/Sofia')::date; result jsonb; stmt text; denied boolean; row_count integer; cutover_time timestamptz;
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
 acceptance:=public.accept_legal_versions('2026-10-08-draft.3','2026-10-08.1','continue');
 IF public.accept_legal_versions('2026-10-08-draft.3','2026-10-08.1','continue')<>acceptance THEN RAISE EXCEPTION 'FAIL duplicate acceptance'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE id=acceptance AND user_id=duid AND length(source_digest)=64 AND accepted_at BETWEEN now()-interval '1 minute' AND clock_timestamp()) THEN RAISE EXCEPTION 'FAIL server acceptance provenance'; END IF;
 acceptance:=public.accept_legal_versions('2026-10-03-draft.2','2026-10-04.2','continue');
 IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE id=acceptance AND privacy_version='2026-10-04.2') THEN RAISE EXCEPTION 'FAIL cached acceptance relabelled'; END IF;
 EXECUTE 'RESET ROLE';
 SELECT created_at INTO cutover_time FROM private.legal_versions WHERE is_current;
 UPDATE private.legal_versions SET created_at=clock_timestamp()-interval '8 days' WHERE is_current;
 EXECUTE 'SET LOCAL ROLE authenticated';
 denied:=false;
 BEGIN PERFORM public.accept_legal_versions('2026-10-03-draft.2','2026-10-04.2','continue'); EXCEPTION WHEN OTHERS THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL expired legal cutover accepted'; END IF;
 PERFORM public.accept_legal_versions('2026-10-08-draft.3','2026-10-08.1','continue');
 EXECUTE 'RESET ROLE';
 UPDATE private.legal_versions SET created_at=cutover_time WHERE is_current;
 EXECUTE 'SET LOCAL ROLE authenticated';
 FOREACH stmt IN ARRAY ARRAY[
  'SELECT public.accept_legal_versions(''old'',''old'',''continue'')',
  'SELECT public.accept_legal_versions(''2026-10-08-draft.3'',''2026-10-08.1'',''advertising'')',
  'DELETE FROM public.legal_acceptances',
  format('SELECT private.record_driver_money_core(%L,''income'',10,''Bypass'')',gen_random_uuid()),
  format('SELECT public.record_driver_money_verified(%L,''income'',10,''Wrong account'',%L)',gen_random_uuid(),admin_uid)
 ] LOOP
  denied:=false;BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN denied:=true;END;
  IF NOT denied THEN RAISE EXCEPTION 'FAIL expected rejection: %',stmt;END IF;
 END LOOP;
 denied:=false;
 BEGIN
  INSERT INTO public.driver_documents(id,driver_id,company_id,type,file_url,status,expires_at,reviewed_at,reviewed_by)
  VALUES(license,did,cid,'license','storage://driver-documents/'||duid||'/'||license||'.pdf','approved',today+30,now(),admin_uid);
 EXCEPTION WHEN insufficient_privilege THEN denied:=true; END;
 IF NOT denied THEN RAISE EXCEPTION 'FAIL direct document insert'; END IF;
 PERFORM public.register_driver_document(license,'license',today+30,duid||'/'||license||'.pdf');
 IF NOT EXISTS(SELECT 1 FROM public.driver_documents WHERE id=license AND status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) THEN RAISE EXCEPTION 'FAIL forged driver approval'; END IF;
 PERFORM public.register_driver_document(insurance,'insurance',today+30,duid||'/'||insurance||'.pdf');
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
  'SELECT public.accept_legal_versions(''2026-10-08-draft.3'',''2026-10-08.1'',''continue'')',
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
ROLLBACK;
