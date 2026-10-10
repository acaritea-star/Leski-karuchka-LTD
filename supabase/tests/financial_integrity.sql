-- Synthetic financial scenarios only, in disposable CI; all rows roll back.
BEGIN;
SET LOCAL statement_timeout='60s';
CREATE OR REPLACE FUNCTION pg_temp.finance_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE IN ('42501','P0001','23505','23514','22023','54000') THEN RETURN; END IF;
  RAISE;
 END;
 RAISE EXCEPTION 'FAIL allowed forbidden financial operation: %',statement;
END $$;
DO $test$
DECLARE
 cid uuid:=gen_random_uuid(); other_cid uuid:=gen_random_uuid(); duid uuid:=gen_random_uuid(); duid2 uuid:=gen_random_uuid();
 admin_uid uuid:=gen_random_uuid(); foreign_uid uuid:=gen_random_uuid(); customer_uid uuid:=gen_random_uuid(); did uuid; did2 uuid;
 income uuid:=gen_random_uuid(); expense uuid:=gen_random_uuid(); handover uuid:=gen_random_uuid();
 ic uuid:=gen_random_uuid(); hc uuid:=gen_random_uuid(); ir uuid:=gen_random_uuid(); er uuid:=gen_random_uuid(); hr uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid();
 vt uuid:=gen_random_uuid(); ride uuid:=gen_random_uuid(); result jsonb; again jsonb; stmt text; measured_at timestamptz;
BEGIN
 INSERT INTO public.companies(id,name,slug) VALUES(cid,'Finance test','finance-'||cid),(other_cid,'Other test','finance-'||other_cid);
 INSERT INTO auth.users(id,email) SELECT u,'finance-'||u||'@example.invalid' FROM unnest(ARRAY[duid,duid2,admin_uid,foreign_uid,customer_uid]) t(u);
 UPDATE public.profiles SET role='DRIVER',company_id=cid WHERE id IN(duid,duid2);
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=cid WHERE id=admin_uid;
 UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=other_cid WHERE id=foreign_uid;
 SELECT id INTO STRICT did FROM public.drivers WHERE user_id=duid;
 SELECT id INTO STRICT did2 FROM public.drivers WHERE user_id=duid2;
 INSERT INTO public.vehicle_types(id,company_id,name) VALUES(vt,cid,'Finance test');
 INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price)
 VALUES(ride,cid,customer_uid,did,vt,43.2,25.6,'Synthetic',43.21,25.61,'Synthetic','in_progress',now()-interval '10 minutes',now()-interval '8 minutes',12.34);
 UPDATE public.taxi_requests SET status='completed',completed_at=clock_timestamp(),final_price=12.34 WHERE id=ride;
 UPDATE public.request_outcomes SET occurred_at='2026-09-30 23:59:58+03' WHERE request_id=ride;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.record_driver_money_verified(income,'income',100.25,'Received',duid,ride);
 PERFORM public.record_driver_money_verified(income,'income',100.25,'Received',duid,ride);
 PERFORM public.record_driver_money_verified(expense,'expense',10.10,'Fuel',duid);
 PERFORM public.record_driver_money_verified(handover,'handover',60,'Cash desk',duid);
 FOREACH stmt IN ARRAY ARRAY[
  format('SELECT public.record_driver_money_verified(%L,''income'',100.25,''Duplicate ride'',%L,%L)',gen_random_uuid(),duid,ride),
  format('SELECT public.record_driver_money_verified(%L,''income'',100.24,''Received'',%L,%L)',income,duid,ride),
  format('SELECT public.record_driver_money_verified(%L,''income'',''NaN'',''Invalid'',%L)',gen_random_uuid(),duid),
  format('SELECT public.record_driver_money_verified(%L,''income'',1.001,''Invalid'',%L)',gen_random_uuid(),duid),
  format('SELECT public.record_driver_money_verified(%L,''income'',-1,''Invalid'',%L)',gen_random_uuid(),duid),
  format('SELECT public.record_driver_money_verified(%L,''income'',0,''Invalid'',%L)',gen_random_uuid(),duid),
  format('SELECT public.accounting_export(''2026-09-01'',''2026-10-01'',%L,%L)',other_cid,did),
  format('UPDATE public.driver_money_entries SET amount=1 WHERE id=%L',income),
  format('DELETE FROM public.driver_money_entries WHERE id=%L',income)
 ] LOOP PERFORM pg_temp.finance_denied(stmt); END LOOP;
 EXECUTE 'RESET ROLE';
 UPDATE public.driver_money_entries SET recorded_at='2026-09-30 23:59:59+03' WHERE id IN(income,expense,handover);

 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money(%L,''confirmation'',0,''Legacy proof bypass'',NULL,%L)',hc,handover));
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''confirmation'',0,''No proof'',%L,NULL,%L)',hc,admin_uid,handover));
 PERFORM public.record_driver_money_verified(ic,'confirmation',0,'Receipt checked',admin_uid,NULL,income,'receipt','R-1');
 PERFORM public.record_driver_money_verified(hc,'confirmation',0,'Cash checked',admin_uid,NULL,handover,'cash_count');
 PERFORM public.record_driver_money_verified(hc,'confirmation',0,'Cash checked',admin_uid,NULL,handover,'cash_count');
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''confirmation'',0,''Duplicate confirm'',%L,NULL,%L,''cash_count'')',gen_random_uuid(),admin_uid,handover));
 EXECUTE 'RESET ROLE';
 UPDATE public.driver_money_entries SET recorded_at='2026-09-30 23:59:59.5+03' WHERE id=ic;
 UPDATE public.driver_money_entries SET recorded_at='2026-10-01 00:00:00+03' WHERE id=hc;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''reversal'',0,''Driver cannot undo confirmation'',%L,NULL,%L,''cash_count'')',gen_random_uuid(),duid,income));
 PERFORM public.record_driver_money_verified(er,'reversal',0,'Expense corrected',duid,NULL,expense);
 EXECUTE 'RESET ROLE';
 UPDATE public.driver_money_entries SET recorded_at='2026-10-02 12:00+03' WHERE id=er;

 PERFORM set_config('request.jwt.claims',json_build_object('sub',foreign_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=cid) THEN RAISE EXCEPTION 'FAIL foreign ledger read'; END IF;
 PERFORM pg_temp.finance_denied(format('SELECT public.accounting_export(''2026-09-01'',''2026-11-01'',%L)',cid));
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''reversal'',0,''Foreign correction'',%L,NULL,%L,''receipt'',''R-X'')',ir,foreign_uid,income));
 EXECUTE 'RESET ROLE';

 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money(%L,''reversal'',0,''Legacy correction bypass'',NULL,%L)',ir,income));
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''reversal'',0,''No proof'',%L,NULL,%L)',ir,admin_uid,income));
 PERFORM public.record_driver_money_verified(ir,'reversal',0,'Incorrect receipt',admin_uid,NULL,income,'receipt','R-2');
 PERFORM public.record_driver_money_verified(ir,'reversal',0,'Incorrect receipt',admin_uid,NULL,income,'receipt','R-2');
 PERFORM public.record_driver_money_verified(hr,'reversal',0,'Incorrect handover',admin_uid,NULL,handover,'cash_book','K-2');
 PERFORM pg_temp.finance_denied(format('SELECT public.record_driver_money_verified(%L,''reversal'',0,''Twice'',%L,NULL,%L,''cash_count'')',gen_random_uuid(),admin_uid,income));
 EXECUTE 'RESET ROLE';
 UPDATE public.driver_money_entries SET recorded_at='2026-10-02 12:01+03' WHERE id IN(ir,hr);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.accounting_export('2026-09-01','2026-10-01',cid);
 IF result->>'report_version'<>'2' OR result#>>'{period,timezone}'<>'Europe/Sofia'
 OR (result#>>'{finances,income}')::numeric<>100.25 OR (result#>>'{finances,expenses}')::numeric<>10.10
 OR (result#>>'{finances,handed_over}')::numeric<>60 OR (result#>>'{finances,confirmed_income}')::numeric<>100.25
 OR (result#>>'{finances,confirmed_handover}')::numeric<>0 OR (result#>>'{balance,closing}')::numeric<>30.15
 OR (result#>>'{balance,unconfirmed_handover}')::numeric<>60 OR (result#>>'{totals,booked}')::numeric<>12.34
 OR (result->>'entry_count')::int<>4 THEN RAISE EXCEPTION 'FAIL September changed retroactively: %',result; END IF;
 again:=public.accounting_export('2026-10-01','2026-11-01',cid);
 IF (again#>>'{finances,income}')::numeric<>-100.25 OR (again#>>'{finances,expenses}')::numeric<>-10.10
 OR (again#>>'{finances,handed_over}')::numeric<>-60 OR (again#>>'{finances,confirmed_income}')::numeric<>-100.25
 OR (again#>>'{finances,confirmed_handover}')::numeric<>0 OR (again#>>'{balance,opening}')::numeric<>30.15
 OR (again#>>'{balance,movement}')::numeric<>-30.15 OR (again#>>'{balance,closing}')::numeric<>0
 OR (again->>'entry_count')::int<>4 THEN RAISE EXCEPTION 'FAIL October correction movements: %',again; END IF;
 IF (SELECT sum((v->>'balance_delta')::numeric) FROM jsonb_array_elements(again->'entries') v)<>-30.15 THEN RAISE EXCEPTION 'FAIL export lines do not reconcile'; END IF;
 EXECUTE 'RESET ROLE';

 -- A corrected linked payment can be recorded once again, without changing
 -- the quote or allowing the original confirmed entry to be edited.
 PERFORM set_config('request.jwt.claims',json_build_object('sub',duid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.record_driver_money_verified(replacement,'income',99.99,'Corrected payment',duid,ride);
 EXECUTE 'RESET ROLE';
 UPDATE public.driver_money_entries SET recorded_at='2026-10-03 12:00+03' WHERE id=replacement;
 -- Modest synthetic volume: test exact cents and complete multi-page export.
 INSERT INTO public.driver_money_entries(company_id,driver_id,driver_user_id,actor_id,kind,amount,note,recorded_at)
 SELECT cid,did,duid,duid,'expense',0.01,'Synthetic cent '||n,'2026-10-03 13:00+03'::timestamptz+n*interval '1 millisecond' FROM generate_series(1,500) n;
 INSERT INTO public.driver_money_entries(company_id,driver_id,driver_user_id,actor_id,kind,amount,note,recorded_at)
 VALUES(cid,did2,duid2,duid2,'income',25.35,'External ride','2026-10-03 14:00+03');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',admin_uid,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 measured_at:=clock_timestamp();
 result:=public.accounting_export('2026-10-01','2026-11-01',cid);
 IF (result->>'entry_count')::int<>506 OR jsonb_array_length(result->'entries')<>506
 OR (result#>>'{balance,closing}')::numeric<>120.34 OR (result#>>'{finances,income}')::numeric<>25.09
 OR (result#>>'{finances,expenses}')::numeric<>-5.10 OR (result->>'driver_count')::int<>2 THEN RAISE EXCEPTION 'FAIL cents, external driver or complete export: %',result; END IF;
 again:=public.accounting_report('2026-10-01','2026-11-01',cid,NULL,20);
 IF jsonb_array_length(again->'entries')<>6 OR again->'finances'<>result->'finances' OR again->'balance'<>result->'balance' THEN RAISE EXCEPTION 'FAIL last page/totals'; END IF;
 again:=public.accounting_report('2026-09-01','2026-10-01',cid);
 IF (again#>>'{reconciliation,0,declared_income}')::numeric<>99.99 OR (again#>>'{reconciliation,0,difference}')::numeric<>87.65
 OR (again#>>'{totals,unreported_completed}')::int<>0 OR (again#>>'{finances,income}')::numeric<>100.25 THEN RAISE EXCEPTION 'FAIL current reconciliation changed dated postings'; END IF;
 RAISE NOTICE 'Finance 506-entry export + paged reports: % ms',round(extract(epoch FROM clock_timestamp()-measured_at)*1000);
 EXECUTE 'RESET ROLE';

 -- DST changes still define local midnight correctly. These four cents must
 -- split as one before October, two in October, one after October.
 INSERT INTO public.driver_money_entries(company_id,driver_id,driver_user_id,actor_id,kind,amount,note,recorded_at)
 SELECT cid,did2,duid2,duid2,'expense',0.01,'Sofia boundary',t FROM unnest(ARRAY[
 '2026-09-30 20:59:59+00'::timestamptz,'2026-09-30 21:00:00+00'::timestamptz,
 '2026-10-31 21:59:59+00'::timestamptz,'2026-10-31 22:00:00+00'::timestamptz]) t;
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.accounting_export('2026-10-01','2026-11-01',cid,did2);
 IF (result->>'entry_count')::int<>3 OR (result#>>'{balance,opening}')::numeric<>-0.01
 OR (result#>>'{balance,closing}')::numeric<>25.32 THEN RAISE EXCEPTION 'FAIL Sofia/DST bounds'; END IF;
 EXECUTE 'RESET ROLE';
 -- An export over the explicit cap must fail, never silently omit lines.
 INSERT INTO public.driver_money_entries(company_id,driver_id,driver_user_id,actor_id,kind,amount,note,recorded_at)
 SELECT cid,did2,duid2,duid2,'expense',0.01,'Export bound '||n,'2026-10-04 12:00+03' FROM generate_series(1,10000) n;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.finance_denied(format('SELECT public.accounting_export(''2026-10-01'',''2026-11-01'',%L)',cid));
 EXECUTE 'RESET ROLE';
 UPDATE public.profiles SET is_active=false WHERE id=admin_uid;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.finance_denied(format('SELECT public.accounting_export(''2026-10-01'',''2026-11-01'',%L)',cid));
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 PERFORM pg_temp.finance_denied(format('SELECT public.accounting_export(''2026-10-01'',''2026-11-01'',%L)',cid));
 EXECUTE 'RESET ROLE';
 IF has_function_privilege('authenticated','private.record_driver_money_core(uuid,text,numeric,text,uuid,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.accounting_export(date,date,uuid,uuid)','EXECUTE')
 OR (SELECT prosecdef OR provolatile<>'s' FROM pg_proc WHERE oid='public.accounting_export(date,date,uuid,uuid)'::regprocedure)
 THEN RAISE EXCEPTION 'FAIL financial API boundary'; END IF;
END $test$;
SELECT 'PASS: cross-month postings, confirmed corrections, evidence bypass denial, duplicate rejection, exact cents, scope isolation, export bounds and Sofia DST' AS result;
ROLLBACK;
