-- Adversarial firm/driver tests. Disposable CI database only; all rows roll back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
SELECT set_config('request.jwt.claims','{}',true);
CREATE FUNCTION pg_temp.isolation_denied(q text) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR unique_violation OR check_violation OR raise_exception THEN RETURN;
 END;
 RAISE EXCEPTION 'FAIL unauthorized operation succeeded: %',q;
END $fn$;
DO $test$
DECLARE
 ca uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid(); aa uuid:=gen_random_uuid(); ab uuid:=gen_random_uuid();
 ua uuid:=gen_random_uuid(); ub uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); root uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid();
 da uuid; db uuid; va uuid:=gen_random_uuid(); vb uuid:=gen_random_uuid(); ta uuid:=gen_random_uuid(); tb uuid:=gen_random_uuid();
 ra uuid:=gen_random_uuid(); rb uuid:=gen_random_uuid(); ea uuid:=gen_random_uuid(); eb uuid:=gen_random_uuid();
 doca uuid:=gen_random_uuid(); docb uuid:=gen_random_uuid(); stray uuid:=gen_random_uuid(); appb uuid:=gen_random_uuid(); appdoc uuid:=gen_random_uuid();
 na uuid:=gen_random_uuid(); nb uuid:=gen_random_uuid(); uid uuid; own_company uuid; foreign_company uuid; foreign_driver uuid; foreign_entry uuid;
 own_path text; foreign_path text; app_path text; stray_path text; relation_name text; visible boolean; affected bigint; report jsonb;
 first_day date:=(now() AT TIME ZONE 'Europe/Sofia')::date-1; last_day date:=(now() AT TIME ZONE 'Europe/Sofia')::date+1;
BEGIN
 INSERT INTO public.companies(id,name,slug,setup_completed_at) VALUES
  (ca,'Synthetic Orion','isolation-'||ca,now()),(cb,'Synthetic Duvka','isolation-'||cb,now());
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT id,'isolation-'||id||'@example.invalid',now()
  FROM unnest(ARRAY[aa,ab,ua,ub,customer,root,extra,candidate]) x(id);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=ca WHERE id=aa;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=cb WHERE id=ab;
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=root;
 UPDATE public.profiles SET role='DRIVER',company_id=ca WHERE id IN(ua,extra);
 UPDATE public.profiles SET role='DRIVER',company_id=cb WHERE id=ub;
 UPDATE public.profiles SET company_id=ca WHERE id=candidate;
 SELECT id INTO STRICT da FROM public.drivers WHERE user_id=ua;
 SELECT id INTO STRICT db FROM public.drivers WHERE user_id=ub;
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(ta,ca,'Isolation A'),(tb,cb,'Isolation B');
 INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number) VALUES
  (va,ca,ta,'Test','A','ISO-'||va),(vb,cb,tb,'Test','B','ISO-'||vb);
 UPDATE public.drivers SET vehicle_id=va,is_verified=true,document_verification_required=false WHERE id=da;
 UPDATE public.drivers SET vehicle_id=vb,is_verified=true,document_verification_required=false WHERE id=db;
 INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
  VALUES(da,ca,43.2,25.6,10,clock_timestamp()),(db,cb,43.2,25.6,10,clock_timestamp());
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,
  destination_latitude,destination_longitude,status,estimated_price,final_price,completed_at)
  VALUES(ra,ca,customer,da,ta,43.2,25.6,43.21,25.61,'completed',10,10,now()),
        (rb,cb,customer,db,tb,43.2,25.6,43.21,25.61,'completed',20,20,now());
 INSERT INTO public.trips(request_id,company_id,driver_id,customer_id,total_amount) VALUES
  (ra,ca,da,customer,10),(rb,cb,db,customer,20);
 INSERT INTO public.request_outcomes(request_id,company_id,driver_id,driver_user_id,outcome,previous_status,occurred_at,booked_amount)
  VALUES(ra,ca,da,ua,'completed','in_progress',now(),10),(rb,cb,db,ub,'completed','in_progress',now(),20);
 INSERT INTO public.payment_transactions(request_id,company_id,amount,method) VALUES(ra,ca,10,'cash'),(rb,cb,20,'cash');
 INSERT INTO public.ledger(company_id,account,entry_type,amount) VALUES(ca,'isolation','debit',10),(cb,'isolation','debit',20);
 INSERT INTO public.notifications(id,user_id,company_id,audience,title) VALUES(na,ua,ca,'driver','Own A'),(nb,ub,cb,'driver','Own B');
 own_path:=ua||'/'||doca||'.pdf'; foreign_path:=ub||'/'||docb||'.pdf';
 stray_path:=ua||'/'||stray||'.pdf'; app_path:=ua||'/'||appb||'/'||appdoc||'.pdf';
 INSERT INTO storage.objects(bucket_id,name) VALUES
  ('driver-documents',own_path),('driver-documents',foreign_path),('driver-documents',stray_path),('driver-documents',app_path);
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,expires_at,file_url) VALUES
  (doca,da,ca,'license',last_day+365,'storage://driver-documents/'||own_path),
  (docb,db,cb,'license',last_day+365,'storage://driver-documents/'||foreign_path);
 -- This person previously applied to B before joining A. Its registered B
 -- application file must not become visible to A through a broad user prefix.
 INSERT INTO public.driver_applications(id,user_id,company_id,full_name,phone,experience,has_vehicle,status)
  VALUES(appb,ua,cb,'Synthetic history','+359000000000','10+',false,'rejected');
 INSERT INTO public.driver_application_documents(id,application_id,user_id,company_id,type,expires_at,file_url)
  VALUES(appdoc,appb,ua,cb,'license',last_day+365,'storage://driver-documents/'||app_path);

 PERFORM set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM public.record_driver_money_verified(ea,'income',10,'Synthetic A',ua,ra,NULL,'declaration',NULL);
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM public.record_driver_money_verified(eb,'income',20,'Synthetic B',ub,rb,NULL,'declaration',NULL);
 RESET ROLE;

 FOREACH uid IN ARRAY ARRAY[aa,ab] LOOP
  own_company:=CASE WHEN uid=aa THEN ca ELSE cb END;
  foreign_company:=CASE WHEN uid=aa THEN cb ELSE ca END;
  foreign_driver:=CASE WHEN uid=aa THEN db ELSE da END;
  foreign_entry:=CASE WHEN uid=aa THEN eb ELSE ea END;
  PERFORM set_config('request.jwt.claims',json_build_object('sub',uid,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE company_id=own_company)
   OR NOT EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=own_company)
   OR NOT EXISTS(SELECT 1 FROM public.ledger WHERE company_id=own_company)
  THEN RAISE EXCEPTION 'FAIL own-company reads were broken'; END IF;
  FOREACH relation_name IN ARRAY ARRAY['drivers','driver_documents','driver_locations','vehicles','taxi_requests','trips',
   'request_outcomes','driver_money_entries','ledger','payment_transactions','audit_log','notifications',
   'partner_invitations','driver_preparation_acceptances','driver_applications','driver_application_documents'] LOOP
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE company_id=$1)',relation_name) INTO visible USING foreign_company;
   IF visible THEN RAISE EXCEPTION 'FAIL foreign-company table read: %',relation_name; END IF;
  END LOOP;
  report:=public.accounting_report(first_day,last_day,own_company,NULL,0);
  IF report#>>'{scope,company_id}'<>own_company::text
   OR (report#>>'{finances,income}')::numeric<>(CASE WHEN uid=aa THEN 10 ELSE 20 END)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(report->'entries') x WHERE x->>'company_id'<>own_company::text)
  THEN RAISE EXCEPTION 'FAIL report includes foreign money'; END IF;
  PERFORM public.company_driver_page(own_company); PERFORM public.company_fleet(own_company); PERFORM public.company_dashboard(own_company);
  PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_report(%L,%L,%L,NULL,0)',first_day,last_day,foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_export(%L,%L,%L,NULL)',first_day,last_day,foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_report(%L,%L,%L,%L,0)',first_day,last_day,own_company,foreign_driver));
  PERFORM pg_temp.isolation_denied(format('SELECT public.company_driver_page(%L)',foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.company_fleet(%L)',foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.company_dashboard(%L)',foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.company_customers(%L)',foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.operational_health(%L)',foreign_company));
  PERFORM pg_temp.isolation_denied(format('SELECT public.driver_verification_status(%L)',foreign_driver));
  PERFORM pg_temp.isolation_denied(format('SELECT public.record_driver_money_verified(%L,''confirmation'',NULL,''Forged'',%L,NULL,%L,''cash_count'',NULL)',gen_random_uuid(),uid,foreign_entry));
  PERFORM pg_temp.isolation_denied(format('INSERT INTO public.payment_transactions(request_id,company_id,amount,method) VALUES(%L,%L,1,''cash'')',CASE WHEN uid=aa THEN rb ELSE ra END,own_company));
  PERFORM pg_temp.isolation_denied(format('INSERT INTO public.notifications(user_id,company_id,title) VALUES(%L,%L,''Forged'')',CASE WHEN uid=aa THEN ub ELSE ua END,own_company));
  UPDATE public.drivers SET is_online=false WHERE id=foreign_driver;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'FAIL foreign-company driver update'; END IF;
  RESET ROLE;
 END LOOP;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',aa,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF NOT private.can_read_driver_document(own_path)
  OR private.can_read_driver_document(foreign_path) OR private.can_read_driver_document(app_path)
  OR private.can_read_driver_document(stray_path) OR private.can_read_driver_document(ua||'/bad.pdf')
  OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name IN(foreign_path,app_path,stray_path))
 THEN RAISE EXCEPTION 'FAIL firm A can read foreign application, foreign driver or unregistered files'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=own_path)
 THEN RAISE EXCEPTION 'FAIL own registered file read'; END IF;
 PERFORM pg_temp.isolation_denied(format('UPDATE public.vehicles SET vehicle_type_id=%L WHERE id=%L',tb,va));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',ab,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=app_path)
  OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=own_path)
 THEN RAISE EXCEPTION 'FAIL registered application stays with its own firm'; END IF;
 RESET ROLE;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF private.current_driver_id() IS DISTINCT FROM da OR NOT public.is_driver(da)
  OR NOT public.is_company_member(ca) OR public.is_company_member(cb)
  OR NOT public.is_driver_of_company(ca) OR public.is_driver_of_company(cb)
  OR public.is_driver(db) OR NOT private.can_read_driver_document(stray_path)
  OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE driver_user_id<>ua)
  OR EXISTS(SELECT 1 FROM public.ledger)
 THEN RAISE EXCEPTION 'FAIL driver identity, upload recovery or private money scope'; END IF;
 report:=public.accounting_export(first_day,last_day,ca,da);
 IF report#>>'{scope,driver_id}'<>da::text OR (report#>>'{finances,income}')::numeric<>10
 THEN RAISE EXCEPTION 'FAIL own driver report'; END IF;
 PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_report(%L,%L,%L,NULL,0)',first_day,last_day,ca));
 PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_export(%L,%L,%L,%L)',first_day,last_day,cb,db));
 PERFORM pg_temp.isolation_denied(format('SELECT public.record_driver_money_verified(%L,''expense'',1,''Wrong actor'',%L,NULL,NULL,''declaration'',NULL)',gen_random_uuid(),ub));
 UPDATE public.notifications SET is_read=true WHERE id=na;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE id=na AND is_read) THEN RAISE EXCEPTION 'FAIL mark own notification read'; END IF;
 PERFORM pg_temp.isolation_denied(format('UPDATE public.notifications SET company_id=%L WHERE id=%L',cb,na));
 PERFORM pg_temp.isolation_denied(format('UPDATE public.notifications SET message=''Forged'' WHERE id=%L',na));
 RESET ROLE;

 -- Even a trusted server write cannot connect a driver/car/category across firms.
 PERFORM pg_temp.isolation_denied(format('UPDATE public.drivers SET vehicle_id=%L WHERE id=%L',vb,da));
 PERFORM pg_temp.isolation_denied(format('UPDATE public.vehicles SET vehicle_type_id=%L WHERE id=%L',tb,va));
 PERFORM pg_temp.isolation_denied(format('UPDATE public.drivers SET vehicle_id=%L WHERE user_id=%L',va,extra));
 -- A mismatched profile is not an operative driver identity, even if a stale row remains.
 UPDATE public.profiles SET company_id=cb WHERE id=ua;
 SET LOCAL ROLE authenticated;
 IF private.current_driver_id() IS NOT NULL OR public.is_driver(da) OR private.can_read_driver_document(stray_path)
  OR public.is_company_member(ca) OR public.is_company_member(cb)
  OR public.is_driver_of_company(ca) OR public.is_driver_of_company(cb)
 THEN RAISE EXCEPTION 'FAIL stale driver membership remains operative'; END IF;
 RESET ROLE;
 UPDATE public.profiles SET company_id=ca WHERE id=ua;

 -- A candidate/customer is not a private fleet member merely because the
 -- profile retains its onboarding or historical company hint.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF public.is_company_member(ca) OR public.is_driver_of_company(ca)
  OR EXISTS(SELECT 1 FROM public.vehicles WHERE id IN(va,vb))
 THEN RAISE EXCEPTION 'FAIL customer company hint grants private fleet membership'; END IF;
 RESET ROLE;

 UPDATE public.profiles SET is_active=false WHERE id=aa;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',aa,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.driver_money_entries) OR EXISTS(SELECT 1 FROM public.drivers)
  OR private.can_read_driver_document(own_path) THEN RAISE EXCEPTION 'FAIL inactive administrator access'; END IF;
 PERFORM pg_temp.isolation_denied(format('SELECT public.accounting_export(%L,%L,%L,NULL)',first_day,last_day,ca));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated','user_metadata',json_build_object('role','SUPER_ADMIN','company_id',cb))::text,true); SET LOCAL ROLE authenticated;
 IF public.is_super_admin() OR public.is_company_admin(cb) OR EXISTS(SELECT 1 FROM public.driver_money_entries)
 THEN RAISE EXCEPTION 'FAIL editable claims elevate a customer'; END IF;
 PERFORM pg_temp.isolation_denied(format('SELECT public.company_driver_page(%L)',cb));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',root,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF NOT public.is_super_admin() OR NOT private.can_read_driver_document(own_path) OR NOT private.can_read_driver_document(foreign_path)
 THEN RAISE EXCEPTION 'FAIL explicit platform administrator access'; END IF;
 PERFORM public.accounting_export(first_day,last_day,ca,NULL); PERFORM public.accounting_export(first_day,last_day,cb,NULL);
 RESET ROLE;
 -- Deleting an idle assigned car must clear only the vehicle, never its firm.
 DELETE FROM public.vehicles WHERE id=va;
 IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE id=da AND vehicle_id IS NULL AND company_id=ca)
 THEN RAISE EXCEPTION 'FAIL vehicle removal changes driver firm'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true); SET LOCAL ROLE anon;
 PERFORM pg_temp.isolation_denied(format('SELECT public.company_driver_page(%L)',ca));
 RESET ROLE;
 IF has_table_privilege('authenticated','public.notifications','INSERT')
  OR has_column_privilege('authenticated','public.notifications','company_id','UPDATE')
  OR NOT has_column_privilege('authenticated','public.notifications','is_read','UPDATE')
  OR has_table_privilege('authenticated','public.payment_transactions','INSERT')
  OR has_table_privilege('authenticated','public.ledger','INSERT')
 THEN RAISE EXCEPTION 'FAIL excess browser write grants'; END IF;
END $test$;
SELECT 'PASS: two-firm raw/RPC/financial/file isolation, role changes, immutable notification ownership and driver/car/category integrity' AS result;
ROLLBACK;
