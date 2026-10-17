-- Synthetic identities only. Opening candidacy never creates a working driver.
BEGIN;
SET LOCAL statement_timeout='30s';
CREATE OR REPLACE FUNCTION pg_temp.open_application_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN RETURN;
 END;
 RAISE EXCEPTION 'FAIL allowed forbidden candidacy operation: %',statement;
END $$;
DO $test$
DECLARE firm uuid:=gen_random_uuid(); closed_firm uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid();
 applicant uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid(); unconfirmed uuid:=gen_random_uuid();
 owner_id uuid:=gen_random_uuid(); foreign_admin uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid();
 application uuid; result jsonb; affected integer;
BEGIN
 INSERT INTO public.companies(id,name,slug,accepts_driver_applications,document_checks_required,setup_completed_at,price_per_km,is_active)
 VALUES(firm,'Open fixture','open-'||firm,true,true,now(),1.23,true),
 (closed_firm,'Invitation fixture','closed-'||closed_firm,false,true,now(),1.23,true),
 (draft,'Draft fixture','draft-'||draft,true,true,NULL,0,false);
 INSERT INTO auth.users(id,email,email_confirmed_at) SELECT u,'open-'||u||'@example.invalid',now()
 FROM unnest(ARRAY[applicant,fresh,owner_id,foreign_admin,staff]) fixture(u);
 INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(unconfirmed,'unconfirmed-'||unconfirmed||'@example.invalid',NULL);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=firm WHERE id=owner_id;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=closed_firm WHERE id=foreign_admin;
 UPDATE public.profiles SET role='DRIVER',company_id=closed_firm WHERE id=staff;
 -- An editable profile email must not replace the confirmed Auth identity.
 UPDATE public.profiles SET email='open-'||applicant||'@example.invalid' WHERE id=unconfirmed;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',applicant,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 result:=public.open_driver_access(firm);
 IF result->>'status'<>'preparation' OR result->>'company_id'<>firm::text OR result->>'role'<>'CUSTOMER'
  OR EXISTS(SELECT 1 FROM public.driver_applications WHERE user_id=applicant)
  OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=applicant)
  OR (SELECT role FROM public.profiles WHERE id=applicant)<>'CUSTOMER' THEN RAISE EXCEPTION 'FAIL open selection grants work or creates a hidden application'; END IF;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',closed_firm));
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',draft));
 UPDATE public.companies SET price_per_km=99,accepts_driver_applications=false WHERE id=firm;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'FAIL candidate changes firm tariffs or candidacy'; END IF;
 application:=public.begin_driver_onboarding(firm,'Open candidate','+359000000000','1–3',false,'');
 IF public.begin_driver_onboarding(firm,'Open candidate','+359000000000','1–3',false,'')<>application
  OR NOT EXISTS(SELECT 1 FROM public.driver_applications WHERE id=application AND company_id=firm AND onboarding_required AND status='pending')
  OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=applicant) OR (SELECT role FROM public.profiles WHERE id=applicant)<>'CUSTOMER'
  THEN RAISE EXCEPTION 'FAIL open preparation bypasses review or duplicates application'; END IF;
 PERFORM pg_temp.open_application_denied(format('SELECT public.review_driver_application(%L,''approve'','''')',application));
 RESET ROLE;
 -- Only this firm's administrator may change its rules; mandatory documents stay on.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_admin,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 UPDATE public.companies SET accepts_driver_applications=false WHERE id=firm;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'FAIL foreign administrator changes candidacy'; END IF;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',firm));
 PERFORM pg_temp.open_application_denied(format('UPDATE public.companies SET price_per_km=-1 WHERE id=%L',closed_firm));
 PERFORM pg_temp.open_application_denied(format('UPDATE public.companies SET price_per_km=''NaN'' WHERE id=%L',closed_firm));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',owner_id,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.open_application_denied(format('UPDATE public.companies SET document_checks_required=false WHERE id=%L',firm));
 PERFORM pg_temp.open_application_denied(format('UPDATE public.companies SET dispatch_radius_km=0 WHERE id=%L',firm));
 UPDATE public.companies SET price_per_km=1.87,accepts_driver_applications=false WHERE id=firm;
 IF NOT FOUND THEN RAISE EXCEPTION 'FAIL own administrator cannot control firm'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE company_id=firm AND actor_id=owner_id AND action='company_rules_changed'
  AND (old_value->>'price_per_km')::numeric=1.23 AND (new_value->>'price_per_km')::numeric=1.87
  AND (old_value->>'accepts_driver_applications')::boolean AND NOT (new_value->>'accepts_driver_applications')::boolean) THEN
  RAISE EXCEPTION 'FAIL firm rule change has no exact actor/before/after audit'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',fresh,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',firm));
 PERFORM pg_temp.open_application_denied(format('SELECT public.begin_driver_onboarding(%L,''Fresh candidate'',''+359000000000'',''1–3'',false,'''')',firm));
 RESET ROLE;
 -- Existing preparation remains resumable when the firm closes new candidacy.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',applicant,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 IF public.resolve_partner_access('driver',NULL)->>'application_id'<>application::text THEN RAISE EXCEPTION 'FAIL closing candidacy loses saved preparation'; END IF;
 RESET ROLE;
 UPDATE public.companies SET accepts_driver_applications=true WHERE id=firm;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',unconfirmed,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',firm));
 PERFORM pg_temp.open_application_denied(format('SELECT public.begin_driver_onboarding(%L,''Unconfirmed'',''+359000000000'',''1–3'',false,'''')',firm));
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',staff,'role','authenticated')::text,true); SET LOCAL ROLE authenticated;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',firm));
 UPDATE public.companies SET price_per_km=99 WHERE id=firm;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'FAIL foreign driver changes tariffs'; END IF;
 RESET ROLE;
 SET LOCAL ROLE anon;
 PERFORM pg_temp.open_application_denied(format('SELECT public.open_driver_access(%L)',firm));
 RESET ROLE;
 RAISE NOTICE 'PASS: explicit open candidacy, confirmed identity, mandatory review, firm-only tariffs and no cross-company role transfer';
END $test$;
ROLLBACK;
