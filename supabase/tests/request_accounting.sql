-- Run after core.sql in the same BEGIN/ROLLBACK; all data is synthetic.
RESET ROLE;
CREATE TEMP TABLE money_test AS SELECT gen_random_uuid() income,gen_random_uuid() expense,gen_random_uuid() handover,gen_random_uuid() confirmation,gen_random_uuid() reversal,gen_random_uuid() admin_user,gen_random_uuid() other_admin,gen_random_uuid() other_company,gen_random_uuid() cancel_request;
GRANT SELECT ON money_test TO authenticated;
INSERT INTO public.companies(id,name,slug) SELECT other_company,'Other test company','other-'||other_company FROM money_test;
INSERT INTO auth.users(id,email) SELECT admin_user,'admin-'||admin_user||'@example.invalid' FROM money_test;
INSERT INTO auth.users(id,email) SELECT other_admin,'other-admin-'||other_admin||'@example.invalid' FROM money_test;
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT company FROM test_ids) WHERE id=(SELECT admin_user FROM money_test);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT other_company FROM money_test) WHERE id=(SELECT other_admin FROM money_test);
-- Prepare an accepted synthetic request to cancel as the customer.
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,estimated_price)
SELECT m.cancel_request,t.company,t.customer,t.driver,t.vehicle_type,43.2,25.6,'Test',43.3,25.7,'Test','accepted',now()-interval '5 minutes',30 FROM money_test m CROSS JOIN test_ids t;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='cancelled',cancel_reason='customer_requested',cancelled_by='driver' WHERE id=(SELECT cancel_request FROM money_test);
SELECT pg_temp.must_fail('SELECT public.accounting_report(current_date,current_date+1,(SELECT company FROM test_ids))');
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''income'',10,''Forbidden'')');
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.request_outcomes WHERE request_id=(SELECT cancel_request FROM money_test) AND previous_status='accepted' AND cancelled_by='customer' AND booked_amount IS NULL AND NOT reconstructed) THEN RAISE EXCEPTION 'FAIL cancellation provenance'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT public.record_driver_money(m.income,'income',15,'Received cash',t.request) FROM money_test m CROSS JOIN test_ids t;
SELECT public.record_driver_money(m.income,'income',15,'Received cash',t.request) FROM money_test m CROSS JOIN test_ids t;
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''income'',15,''Duplicate'',request) FROM test_ids');
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''income'',-1,''Negative'')');
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''income'',1.234,''Fraction'')');
SELECT public.record_driver_money(expense,'expense',5,'Fuel') FROM money_test;
SELECT public.record_driver_money(handover,'handover',10,'Cash desk') FROM money_test;
SELECT public.record_driver_money(reversal,'reversal',0,'Wrong expense',NULL,expense) FROM money_test;
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''confirmation'',0,''Self confirm'',NULL,handover) FROM money_test');
SELECT pg_temp.must_fail('INSERT INTO public.driver_money_entries(id,company_id,driver_user_id,kind,amount,note) SELECT gen_random_uuid(),company,driver_user,''income'',10,''Forged'' FROM test_ids');
SELECT pg_temp.must_fail('UPDATE public.driver_money_entries SET amount=1 WHERE id=(SELECT income FROM money_test)');
SELECT pg_temp.must_fail('DELETE FROM public.request_outcomes WHERE request_id=(SELECT request FROM test_ids)');
DO $$ DECLARE report jsonb; BEGIN
 report:=public.accounting_report((now() AT TIME ZONE 'Europe/Sofia')::date,(now() AT TIME ZONE 'Europe/Sofia')::date+1,NULL,(SELECT driver FROM test_ids));
 IF (report#>>'{totals,completed}')::int<>1 OR (report#>>'{totals,cancelled}')::int<>1 OR (report#>>'{totals,booked}')::numeric<>15 THEN RAISE EXCEPTION 'FAIL report totals %',report; END IF;
 IF (report#>>'{finances,income}')::numeric<>15 OR (report#>>'{finances,expenses}')::numeric<>0 THEN RAISE EXCEPTION 'FAIL reversal or duplicate total'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_admin,'role','authenticated')::text,true) FROM money_test;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.request_outcomes WHERE company_id=(SELECT company FROM test_ids)) OR EXISTS(SELECT 1 FROM public.driver_money_entries WHERE company_id=(SELECT company FROM test_ids)) THEN RAISE EXCEPTION 'FAIL cross company read'; END IF; END $$;
SELECT pg_temp.must_fail('SELECT public.accounting_report(current_date,current_date+1,(SELECT company FROM test_ids))');
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''confirmation'',0,''Other company'',NULL,handover) FROM money_test');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true) FROM money_test;
SET LOCAL ROLE authenticated;
SELECT public.record_driver_money_verified(confirmation,'confirmation',0,'Cash received',admin_user,NULL,handover,'cash_count') FROM money_test;
SELECT public.record_driver_money_verified(confirmation,'confirmation',0,'Cash received',admin_user,NULL,handover,'cash_count') FROM money_test;
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''confirmation'',0,''Duplicate confirmation'',NULL,handover) FROM money_test');
DO $$ DECLARE report jsonb; BEGIN
 report:=public.accounting_report((now() AT TIME ZONE 'Europe/Sofia')::date,(now() AT TIME ZONE 'Europe/Sofia')::date+1,(SELECT company FROM test_ids));
 IF (report#>>'{finances,confirmed_handover}')::numeric<>10 THEN RAISE EXCEPTION 'FAIL confirmed receipt'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.record_driver_money(gen_random_uuid(),''reversal'',0,''After confirmation'',NULL,handover) FROM money_test');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.must_fail('SELECT public.accounting_report(current_date,current_date+1)');
SELECT pg_temp.must_fail('SELECT * FROM public.driver_money_entries');
RESET ROLE;
SELECT 'PASS: cancellation stage/actor, no cancellation revenue, idempotent money, duplicate linked income, reversal, append-only, driver/customer/company isolation, independent confirmation, anonymous denial' result;
-- An in-progress trip stays protected from a customer cancellation.
RESET ROLE;
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,destination_latitude,destination_longitude,destination_address,status,accepted_at,started_at,estimated_price)
SELECT gen_random_uuid(),company,customer,driver,vehicle_type,43.2,25.6,'Test',43.3,25.7,'Test','in_progress',now()-interval '10 minutes',now()-interval '5 minutes',20 FROM test_ids;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('UPDATE public.taxi_requests SET status=''cancelled'' WHERE company_id=(SELECT company FROM test_ids) AND status=''in_progress''');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true) FROM money_test;
SET LOCAL ROLE authenticated;
UPDATE public.taxi_requests SET status='cancelled',cancel_reason='Interrupted by administrator' WHERE company_id=(SELECT company FROM test_ids) AND status='in_progress';
DO $$ DECLARE report jsonb; BEGIN
 report:=public.accounting_report((now() AT TIME ZONE 'Europe/Sofia')::date,(now() AT TIME ZONE 'Europe/Sofia')::date+1,(SELECT company FROM test_ids));
 IF (report#>>'{totals,interrupted}')::int<>1 OR (report#>>'{totals,booked}')::numeric<>15 THEN RAISE EXCEPTION 'FAIL interrupted trip included in revenue'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: active-trip cancellation restriction and interrupted trip classification' result;
