-- Native disposable Supabase only. No production rows, paid APIs or emails.
BEGIN;
SET LOCAL statement_timeout='45s';
SET LOCAL lock_timeout='3s';
SELECT set_config('request.jwt.claims','{}',true);
UPDATE private.app_security SET staff_mfa_enforced=false WHERE singleton;
CREATE FUNCTION pg_temp.division_denied(q text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
 BEGIN EXECUTE q;
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR unique_violation OR check_violation OR raise_exception THEN RETURN;
 END;
 RAISE EXCEPTION 'FAIL unauthorized division operation succeeded: %',q;
END $f$;
DO $test$
DECLARE parent uuid:=gen_random_uuid(); foreign_company uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
 owner_id uuid:=gen_random_uuid(); local_a uuid:=gen_random_uuid(); local_b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 user_a uuid:=gen_random_uuid(); user_b uuid:=gen_random_uuid(); foreign_driver_user uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); candidate uuid:=gen_random_uuid();
 driver_a uuid; driver_b uuid; foreign_driver uuid; type_a uuid:=gen_random_uuid(); type_b uuid:=gen_random_uuid();
 ride uuid:=gen_random_uuid(); quote uuid:=gen_random_uuid(); operation uuid:=gen_random_uuid(); entry_b uuid:=gen_random_uuid(); expense uuid:=gen_random_uuid();
 doc_a uuid:=gen_random_uuid(); doc_b uuid:=gen_random_uuid(); receipt uuid:=gen_random_uuid(); invite uuid:=gen_random_uuid(); notice uuid;
 payload jsonb; child jsonb; report jsonb; ordinary jsonb; tariff jsonb; notice_path text; receipt_path text; visible bigint;
 from_day date:=date_trunc('month',now() AT TIME ZONE 'Europe/Sofia')::date;
 until_day date:=(date_trunc('month',now() AT TIME ZONE 'Europe/Sofia')+interval '1 month')::date;
BEGIN
 INSERT INTO public.companies(id,name,slug,setup_completed_at) VALUES
  (parent,'Synthetic parent','division-parent-'||parent,NULL),(foreign_company,'Unrelated firm','division-foreign-'||foreign_company,now());
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT uid,uid||'@example.invalid',now()
 FROM unnest(ARRAY[owner_id,local_a,local_b,outsider,user_a,user_b,foreign_driver_user,customer,candidate]) ids(uid);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=parent WHERE id=owner_id;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=foreign_company WHERE id=outsider;
 payload:=jsonb_build_object('name','Synthetic parent — A','service_city','Synthetic City A',
  'service_latitude',43.0757,'service_longitude',25.6172,'service_radius_km',8);
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 child:=public.create_company_division(a,parent,payload);
 IF child->>'parent_company_id'<>parent::text OR (child->>'is_active')::boolean OR child->>'setup_completed_at' IS NOT NULL
  OR NOT (child->>'document_checks_required')::boolean THEN RAISE EXCEPTION 'FAIL unsafe new division defaults'; END IF;
 IF public.create_company_division(a,parent,payload)->>'id'<>a::text THEN RAISE EXCEPTION 'FAIL idempotent division creation'; END IF;
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',a,parent,payload||'{"name":"Changed intent"}'::jsonb));
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),foreign_company,payload));
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),a,payload));
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),parent,payload));
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),parent,
  payload||'{"service_city":"  synthetic   CITY A  "}'::jsonb));
 child:=public.create_company_division(b,parent,jsonb_build_object('name','Synthetic parent — B','service_city','Synthetic City B',
  'service_latitude',43.1278,'service_longitude',25.7017,'service_radius_km',8));
 PERFORM pg_temp.division_denied(format('UPDATE public.companies SET parent_company_id=%L WHERE id=%L',foreign_company,a));
 PERFORM pg_temp.division_denied(format('UPDATE public.companies SET parent_company_id=NULL WHERE id=%L',a));
 PERFORM pg_temp.division_denied(format('UPDATE public.companies SET night_base_fare=1 WHERE id=%L',a));
 PERFORM pg_temp.division_denied(format('UPDATE public.companies SET night_base_fare=''NaN'',night_price_per_km=1,night_price_per_minute=0,night_min_fare=0 WHERE id=%L',a));
 PERFORM pg_temp.division_denied(format('UPDATE public.companies SET service_latitude=51.5,service_longitude=-0.1 WHERE id=%L',a));
 RESET ROLE;
 IF (SELECT count(*) FROM public.companies WHERE parent_company_id=parent)<>2 THEN RAISE EXCEPTION 'FAIL duplicate division creation'; END IF;
 IF (SELECT parent_company_id FROM public.companies WHERE id=foreign_company) IS NOT NULL THEN RAISE EXCEPTION 'FAIL existing firm attached to parent'; END IF;

 -- A draft city cannot shadow an existing operating firm's pickup zone.
 IF private.division_covers_pickup(a,43.0757,25.6172) THEN RAISE EXCEPTION 'FAIL unconfigured city accepts pickups'; END IF;
 UPDATE public.companies SET setup_completed_at=now(),is_active=true,document_checks_required=false,dispatch_radius_km=30,
  base_fare=1.40,price_per_km=.70,price_per_minute=0,min_fare=0,
  night_base_fare=1.60,night_price_per_km=.80,night_price_per_minute=0,night_min_fare=0 WHERE id=a;
 UPDATE public.companies SET setup_completed_at=now(),is_active=true,document_checks_required=false,dispatch_radius_km=30,
  base_fare=2.00,price_per_km=.90,price_per_minute=0,min_fare=0 WHERE id=b;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=a WHERE id=local_a;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=b WHERE id=local_b;
 UPDATE public.profiles SET role='DRIVER',company_id=a WHERE id=user_a;
 UPDATE public.profiles SET role='DRIVER',company_id=b WHERE id=user_b;
 UPDATE public.profiles SET role='DRIVER',company_id=foreign_company WHERE id=foreign_driver_user;
 SELECT id INTO STRICT driver_a FROM public.drivers WHERE user_id=user_a;
 SELECT id INTO STRICT driver_b FROM public.drivers WHERE user_id=user_b;
 SELECT id INTO STRICT foreign_driver FROM public.drivers WHERE user_id=foreign_driver_user;
 INSERT INTO public.vehicle_types(id,company_id,name,service_class) VALUES(type_a,a,'Division A','standard'),(type_b,b,'Division B','standard');
 INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number) VALUES
  (user_a,a,type_a,'Synthetic','A','CITY-A-'||left(a::text,8)),(user_b,b,type_b,'Synthetic','B','CITY-B-'||left(b::text,8));
 UPDATE public.drivers SET vehicle_id=user_id,is_verified=true,document_verification_required=false WHERE id IN(driver_a,driver_b);
 INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
  VALUES(driver_a,a,43.0757,25.6172,10,clock_timestamp()),(driver_b,b,43.0757,25.6172,10,clock_timestamp());
 UPDATE public.drivers SET is_online=true WHERE id IN(driver_a,driver_b);
 IF NOT private.division_covers_pickup(a,43.0757,25.6172) OR private.division_covers_pickup(b,43.0757,25.6172)
  OR NOT private.division_covers_pickup(b,43.1278,25.7017) OR private.division_covers_pickup(a,43.1278,25.7017)
  OR private.division_covers_pickup(parent,43.0757,25.6172) THEN RAISE EXCEPTION 'FAIL pickup-based city selection'; END IF;
 IF (SELECT count(*) FROM public.companies c WHERE c.id IN(a,b) AND private.division_covers_pickup(c.id,43.1000,25.6600))<>1 THEN
  RAISE EXCEPTION 'FAIL overlapping city zones produced multiple tariffs'; END IF;
 IF (SELECT count(*) FROM private.marketplace_drivers(43.0757,25.6172) WHERE company_id IN(a,b))<>1
  OR EXISTS(SELECT 1 FROM private.eligible_drivers(b,type_b,43.0757,25.6172)) THEN RAISE EXCEPTION 'FAIL nearby driver crosses company/city scope'; END IF;
 UPDATE public.companies SET is_active=false WHERE id=a;
 IF EXISTS(SELECT 1 FROM private.marketplace_drivers(43.0757,25.6172) WHERE company_id IN(a,b,parent)) THEN
  RAISE EXCEPTION 'FAIL paused city replaced by sibling or headquarters'; END IF;
 UPDATE public.companies SET is_active=true WHERE id=a;

 -- Day/night selection is server-owned and uses Europe/Sofia through DST.
 SELECT private.company_tariff(c,'2026-10-18T18:59:59Z') INTO tariff FROM public.companies c WHERE id=a;
 IF tariff->>'tariff_period'<>'day' OR (tariff->>'price_per_km')::numeric<>.70 THEN RAISE EXCEPTION 'FAIL day cutoff'; END IF;
 SELECT private.company_tariff(c,'2026-10-18T19:00:00Z') INTO tariff FROM public.companies c WHERE id=a;
 IF tariff->>'tariff_period'<>'night' OR (tariff->>'price_per_km')::numeric<>.80 THEN RAISE EXCEPTION 'FAIL summer night cutoff'; END IF;
 SELECT private.company_tariff(c,'2026-10-25T19:59:59Z') INTO tariff FROM public.companies c WHERE id=a;
 IF tariff->>'tariff_period'<>'day' THEN RAISE EXCEPTION 'FAIL DST day cutoff'; END IF;
 SELECT private.company_tariff(c,'2026-10-25T20:00:00Z') INTO tariff FROM public.companies c WHERE id=a;
 IF tariff->>'tariff_period'<>'night' THEN RAISE EXCEPTION 'FAIL DST night cutoff'; END IF;
 SELECT private.company_tariff(c,'2026-10-26T04:00:00Z') INTO tariff FROM public.companies c WHERE id=a;
 IF tariff->>'tariff_period'<>'day' THEN RAISE EXCEPTION 'FAIL morning cutoff'; END IF;
 SELECT private.company_tariff(c,'2026-10-18T19:00:00Z') INTO tariff FROM public.companies c WHERE id=b;
 IF (tariff->>'price_per_km')::numeric<>.90 THEN RAISE EXCEPTION 'FAIL legacy same-day/night fallback'; END IF;

 INSERT INTO public.ride_quotes(id,customer_id,company_id,vehicle_type_id,payload)
 VALUES(quote,customer,a,type_a,jsonb_build_object('pickup_latitude',43.0757,'pickup_longitude',25.6172,
  'destination_latitude',43.1278,'destination_longitude',25.7017,'pickup_address','Synthetic A','destination_address','Synthetic B',
  'distance_km',12.4,'duration_min',20,'total',12.34,'breakdown',jsonb_build_object('total',12.34,'tariff_period','day',
  'carrier_choice',jsonb_build_object('service_class','standard','company_name','Synthetic parent — A','type_name','Division A','capacity',4))));
 PERFORM set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM public.create_taxi_request(quote,ride,'cash'); RESET ROLE;
 IF (SELECT count(*) FROM public.request_push_recipients(ride))<>1 THEN RAISE EXCEPTION 'FAIL city request recipients'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',user_b,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.driver_incoming_requests() WHERE id=ride) THEN RAISE EXCEPTION 'FAIL sibling driver sees exact city request'; END IF;
 PERFORM pg_temp.division_denied(format('SELECT public.accept_taxi_request(%L)',ride)); RESET ROLE;
 -- A later rate edit never rewrites an already issued exact quote.
 UPDATE public.companies SET price_per_km=1.01 WHERE id=a;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',user_a,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM public.accept_taxi_request(ride);
 UPDATE public.taxi_requests SET status='arrived',arrived_at=clock_timestamp() WHERE id=ride;
 UPDATE public.taxi_requests SET status='in_progress',started_at=clock_timestamp() WHERE id=ride;
 RESET ROLE;
 -- Pausing affects new offers; a driver can still collect/finish an active ride.
 UPDATE public.companies SET is_active=false WHERE id=a;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',user_a,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM public.complete_ride_payment(operation,ride,user_a,'cash',NULL,'');
 PERFORM public.complete_ride_payment(operation,ride,user_a,'cash',NULL,'');
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=ride AND company_id=a AND status='completed' AND final_price=12.34)
  OR (SELECT count(*) FROM public.driver_money_entries WHERE request_id=ride AND kind='income')<>1
  OR NOT EXISTS(SELECT 1 FROM public.ride_payment_receipts WHERE request_id=ride AND company_id=a AND received_amount=12.34) THEN
  RAISE EXCEPTION 'FAIL cross-city ride scope, fare or idempotent payment'; END IF;
 UPDATE public.companies SET is_active=true WHERE id=a;
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,payment_method,note)
 VALUES(entry_b,b,driver_b,user_b,user_b,'income',20,'card','Synthetic B income'),
  (expense,a,driver_a,user_a,user_a,'expense',2,'cash','Synthetic A expense'),
  (gen_random_uuid(),foreign_company,foreign_driver,foreign_driver_user,foreign_driver_user,'income',1000,'cash','Unrelated income');
 receipt_path:=user_a||'/'||expense||'/'||receipt||'.png';
 INSERT INTO storage.objects(bucket_id,name,metadata) VALUES('expense-receipts',receipt_path,'{"size":4,"mimetype":"image/png"}');
 INSERT INTO public.expense_receipts(id,entry_id,company_id,driver_id,driver_user_id,slot,file_name,mime_type,byte_size,digest,path,uploaded_at)
 VALUES(receipt,expense,a,driver_a,user_a,1,'synthetic.png','image/png',4,repeat('a',64),receipt_path,now());
 INSERT INTO storage.objects(bucket_id,name) VALUES('driver-documents',user_a||'/'||doc_a||'.pdf'),('driver-documents',user_b||'/'||doc_b||'.pdf');
 INSERT INTO public.driver_documents(id,driver_id,company_id,type,expires_at,file_url) VALUES
  (doc_a,driver_a,a,'license',current_date+365,'storage://driver-documents/'||user_a||'/'||doc_a||'.pdf'),
  (doc_b,driver_b,b,'license',current_date+365,'storage://driver-documents/'||user_b||'/'||doc_b||'.pdf');
 INSERT INTO public.ledger(company_id,account,entry_type,amount) VALUES(a,'division','debit',12.34),(b,'division','debit',20),(foreign_company,'foreign','debit',1000);

 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF NOT public.is_company_admin(a) OR NOT public.is_company_admin(b) OR public.is_company_admin(foreign_company) THEN RAISE EXCEPTION 'FAIL parent company authorization'; END IF;
 IF (SELECT count(*) FROM public.ledger WHERE company_id IN(a,b))<>2 OR EXISTS(SELECT 1 FROM public.ledger WHERE company_id=foreign_company) THEN RAISE EXCEPTION 'FAIL parent ledger isolation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.expense_receipts WHERE id=receipt)
  OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='expense-receipts' AND name=receipt_path)
  OR (SELECT count(*) FROM public.driver_documents WHERE id IN(doc_a,doc_b))<>2 THEN RAISE EXCEPTION 'FAIL parent document access'; END IF;
 report:=public.company_group_report(parent,from_day,until_day);
 IF jsonb_array_length(report->'companies')<>3 OR (report->'total'->>'income')::numeric<>32.34
  OR (report->'total'->>'cash_income')::numeric<>12.34 OR (report->'total'->>'card_income')::numeric<>20
  OR (report->'total'->>'expenses')::numeric<>2 OR (report->'total'->>'cash_closing')::numeric<>10.34 THEN
  RAISE EXCEPTION 'FAIL aggregate includes foreign data or miscounts money: %',report; END IF;
 ordinary:=public.accounting_report(from_day,until_day,a,NULL,0);
 IF (ordinary->'finances'->>'income')::numeric<>12.34 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(report->'companies') row
  WHERE row->>'id'=a::text AND row->'summary'->>'income'=ordinary->'finances'->>'income') THEN RAISE EXCEPTION 'FAIL group summary differs from ordinary accounting'; END IF;
 PERFORM public.create_partner_invitation(invite,'company',candidate||'@example.invalid',b);
 RESET ROLE;
 SET LOCAL ROLE service_role;
 child:=public.claim_partner_invitation_email(invite,owner_id,false);
 IF (child->>'claimed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL parent administrator invitation capability'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',candidate,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 child:=public.resolve_partner_access('company',invite);
 IF child->>'role'<>'COMPANY_ADMIN' OR child->>'company_id'<>b::text OR NOT public.is_company_admin(b) OR public.is_company_admin(a) OR public.is_company_admin(parent) THEN
  RAISE EXCEPTION 'FAIL invited local manager escaped division'; END IF;
 RESET ROLE;

 PERFORM private.notify_company(a,'application_submitted','division-fixture-'||a,'Synthetic application','Synthetic notice','{}',NULL);
 SELECT id INTO notice FROM public.notifications WHERE user_id=owner_id AND company_id=a AND event_key='division-fixture-'||a;
 IF notice IS NULL OR NOT EXISTS(SELECT 1 FROM public.notifications WHERE user_id=local_a AND company_id=a AND event_key='division-fixture-'||a)
  OR EXISTS(SELECT 1 FROM public.notifications WHERE user_id=local_b AND company_id=a AND event_key='division-fixture-'||a) THEN RAISE EXCEPTION 'FAIL scoped parent/local notifications'; END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 notice_path:=public.open_notification(notice);
 IF strpos(notice_path,'company='||a::text)=0 THEN RAISE EXCEPTION 'FAIL parent notification loses selected division'; END IF;
 RESET ROLE;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',local_a,'role','authenticated','user_metadata',json_build_object('role','SUPER_ADMIN','company_id',parent))::text,true); SET LOCAL ROLE authenticated;
 IF NOT public.is_company_admin(a) OR public.is_company_admin(b) OR public.is_company_admin(parent) OR public.is_super_admin() THEN RAISE EXCEPTION 'FAIL local manager hierarchy isolation'; END IF;
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id IN(b,foreign_company))
  OR EXISTS(SELECT 1 FROM public.drivers WHERE company_id=b) OR EXISTS(SELECT 1 FROM public.ledger WHERE company_id=b)
  OR EXISTS(SELECT 1 FROM public.driver_documents WHERE id=doc_b)
  OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='driver-documents' AND name=user_b||'/'||doc_b||'.pdf') THEN RAISE EXCEPTION 'FAIL sibling data visible to local manager'; END IF;
 PERFORM pg_temp.division_denied(format('SELECT public.company_group_report(%L,%L,%L)',parent,from_day,until_day));
 PERFORM pg_temp.division_denied(format('SELECT public.accounting_report(%L,%L,%L,NULL,0)',from_day,until_day,b));
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),parent,payload));
 PERFORM pg_temp.division_denied(format('SELECT public.create_partner_invitation(%L,''company'',%L,%L)',gen_random_uuid(),'uninvited@example.invalid',a));
 UPDATE public.profiles SET is_active=false WHERE id IN(owner_id,local_b); GET DIAGNOSTICS visible=ROW_COUNT;
 IF visible<>0 THEN RAISE EXCEPTION 'FAIL local manager modified headquarters or sibling'; END IF;
 RESET ROLE;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',local_b,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF EXISTS(SELECT 1 FROM public.expense_receipts WHERE id=receipt) OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='expense-receipts' AND name=receipt_path) THEN RAISE EXCEPTION 'FAIL sibling expense proof leak'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 UPDATE public.profiles SET is_active=false WHERE id=local_b; GET DIAGNOSTICS visible=ROW_COUNT;
 IF visible<>1 THEN RAISE EXCEPTION 'FAIL parent cannot revoke a local manager'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',local_b,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF public.is_company_admin(b) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=b) THEN RAISE EXCEPTION 'FAIL revoked local access retained'; END IF;
 RESET ROLE;
 UPDATE private.app_security SET staff_mfa_enforced=true WHERE singleton;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated','aal','aal1')::text,true); SET LOCAL ROLE authenticated;
 IF public.is_company_admin(a) THEN RAISE EXCEPTION 'FAIL hierarchy bypasses staff MFA'; END IF;
 PERFORM pg_temp.division_denied(format('SELECT public.create_company_division(%L,%L,%L::jsonb)',gen_random_uuid(),parent,payload));
 PERFORM pg_temp.division_denied(format('SELECT public.company_group_report(%L,%L,%L)',parent,from_day,until_day));
 RESET ROLE;
 RAISE NOTICE 'PASS city divisions: hierarchy, parent/local access, zones, DST prices, cross-city checkout, documents, reports, notifications, manager invitations and MFA';
END $test$;
ROLLBACK;
