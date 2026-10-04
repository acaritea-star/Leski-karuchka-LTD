-- After core.sql; execute in the same transaction and always ROLLBACK.
RESET ROLE;
CREATE TEMP TABLE summary_ids AS SELECT gen_random_uuid() company,gen_random_uuid() foreign_company,
 gen_random_uuid() admin_user,gen_random_uuid() foreign_admin,gen_random_uuid() driver_user,
 gen_random_uuid() customer,gen_random_uuid() other_customer,gen_random_uuid() vehicle_type,
 gen_random_uuid() vehicle,NULL::uuid driver;
GRANT SELECT ON summary_ids TO authenticated,anon;
INSERT INTO public.companies(id,name,slug) SELECT company,'Summary regression','summary-test-'||company FROM summary_ids;
INSERT INTO public.companies(id,name,slug) SELECT foreign_company,'Foreign summary regression','summary-test-'||foreign_company FROM summary_ids;
INSERT INTO auth.users(id,email) SELECT id,'summary-test-'||id||'@example.invalid' FROM summary_ids,
 LATERAL unnest(ARRAY[admin_user,foreign_admin,driver_user,customer,other_customer]) AS s(id);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT company FROM summary_ids) WHERE id=(SELECT admin_user FROM summary_ids);
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT foreign_company FROM summary_ids) WHERE id=(SELECT foreign_admin FROM summary_ids);
UPDATE public.profiles SET role='DRIVER',company_id=(SELECT company FROM summary_ids) WHERE id=(SELECT driver_user FROM summary_ids);
UPDATE summary_ids SET driver=(SELECT id FROM public.drivers WHERE user_id=summary_ids.driver_user);
INSERT INTO public.vehicle_types(id,company_id,name) SELECT vehicle_type,company,'Summary test car' FROM summary_ids;
INSERT INTO public.vehicles(id,company_id,vehicle_type_id,make,model,registration_number)
 SELECT vehicle,company,vehicle_type,'Test','Test','SUM-'||left(vehicle::text,8) FROM summary_ids;
UPDATE public.drivers SET vehicle_id=(SELECT vehicle FROM summary_ids),is_verified=true WHERE id=(SELECT driver FROM summary_ids);
INSERT INTO public.driver_locations(driver_id,company_id,latitude,longitude,accuracy,position_at)
 SELECT driver,company,43.2,25.6,10,now() FROM summary_ids;
UPDATE public.drivers SET is_online=true WHERE id=(SELECT driver FROM summary_ids);
-- Synthetic historical records exceed the default REST row cap. Only the
-- aggregate result crosses the API; no production profile or ride is modified.
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,completed_at,estimated_price,final_price)
 SELECT gen_random_uuid(),company,customer,driver,vehicle_type,43.2,25.6,'Summary test',43.21,25.61,'Summary test',
 'completed','2026-10-25 10:00:00+00'::timestamptz,999,1 FROM summary_ids CROSS JOIN generate_series(1,1200);
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,completed_at,estimated_price,final_price)
 SELECT gen_random_uuid(),company,customer,driver,vehicle_type,43.2,25.6,'Summary test',43.21,25.61,'Summary test',
 'completed',s.stamp,999,s.amount FROM summary_ids CROSS JOIN (VALUES
 ('2026-10-25 21:30:00+00'::timestamptz,2),('2026-10-25 22:00:00+00'::timestamptz,3),
 ('2026-10-18 20:59:00+00'::timestamptz,4)) AS s(stamp,amount);
INSERT INTO public.taxi_requests(id,company_id,customer_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,expires_at,estimated_price)
 SELECT gen_random_uuid(),company,customer,vehicle_type,43.2,25.6,'Summary test',43.21,25.61,'Summary test',
 'pending',now()-interval '1 minute',9000 FROM summary_ids;
INSERT INTO public.taxi_requests(id,company_id,customer_id,driver_id,vehicle_type_id,pickup_latitude,pickup_longitude,pickup_address,
 destination_latitude,destination_longitude,destination_address,status,estimated_price)
 SELECT gen_random_uuid(),company,other_customer,driver,vehicle_type,43.2,25.6,'Summary test',43.21,25.61,'Summary test',
 status,9000 FROM summary_ids CROSS JOIN (VALUES('accepted'::public.request_status),('cancelled'::public.request_status)) AS s(status);

SELECT set_config('request.jwt.claims',json_build_object('sub',admin_user,'role','authenticated')::text,true) FROM summary_ids;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.company_dashboard((SELECT company FROM summary_ids),'2026-10-25');
 IF (result#>>'{stats,completedOrders}')::int<>1203 OR (result#>>'{stats,cancelledOrders}')::int<>1
  OR (result#>>'{stats,activeOrders}')::int<>1 OR (result#>>'{stats,totalRevenue}')::numeric<>1209
  OR (result#>>'{stats,totalDrivers}')::int<>1 OR (result#>>'{stats,onlineDrivers}')::int<>1
  OR jsonb_array_length(result->'days')<>7 OR (result#>>'{days,6,orders}')::int<>1201
  OR (result#>>'{days,6,revenue}')::numeric<>1202 THEN RAISE EXCEPTION 'FAIL aggregate/DST/cap/expiry %',result; END IF;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM summary_ids;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE result jsonb; BEGIN
 result:=public.driver_day_summary((SELECT driver FROM summary_ids),'2026-10-25');
 IF (result->>'trips')::int<>1201 OR (result->>'earnings')::numeric<>1202 THEN RAISE EXCEPTION 'FAIL 25-hour driver day %',result; END IF;
 result:=public.driver_day_summary((SELECT driver FROM summary_ids),'2026-10-26');
 IF (result->>'trips')::int<>1 OR (result->>'earnings')::numeric<>3 THEN RAISE EXCEPTION 'FAIL next-day boundary %',result; END IF;
END $test$;
SELECT pg_temp.must_fail('SELECT public.company_dashboard((SELECT company FROM summary_ids))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',foreign_admin,'role','authenticated')::text,true) FROM summary_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.company_dashboard((SELECT company FROM summary_ids))');
SELECT pg_temp.must_fail('SELECT public.driver_day_summary((SELECT driver FROM summary_ids))');
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated',
 'user_metadata',json_build_object('role','SUPER_ADMIN'))::text,true) FROM summary_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.company_dashboard((SELECT company FROM summary_ids))');
SELECT pg_temp.must_fail('SELECT public.driver_day_summary((SELECT driver FROM summary_ids))');
RESET ROLE;
UPDATE public.profiles SET is_active=false WHERE id=(SELECT driver_user FROM summary_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM summary_ids;
SET LOCAL ROLE authenticated;
SELECT pg_temp.must_fail('SELECT public.driver_day_summary((SELECT driver FROM summary_ids))');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.must_fail('SELECT public.company_dashboard((SELECT company FROM summary_ids))');
SELECT pg_temp.must_fail('SELECT public.driver_day_summary((SELECT driver FROM summary_ids))');
RESET ROLE;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.company_dashboard(uuid,date)'::regprocedure,
  'public.driver_day_summary(uuid,date)'::regprocedure) AND prosecdef) THEN RAISE EXCEPTION 'FAIL aggregate bypasses RLS'; END IF;
END $test$;
SELECT 'PASS: server summaries over 1200 rows, final-price preference, expired pending exclusion, Sofia DST boundaries, driver/company/customer/inactive/anonymous isolation' AS result;
