-- Runs after core.sql inside its rollback-only transaction.
SAVEPOINT scale_policy_suite;
RESET ROLE;
DO $$ BEGIN
 IF has_function_privilege('anon','private.current_driver_id()','EXECUTE')
  OR NOT has_function_privilege('authenticated','private.current_driver_id()','EXECUTE') THEN
  RAISE EXCEPTION 'FAIL current-driver helper ACL'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',driver_user,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF private.current_driver_id() IS DISTINCT FROM (SELECT driver FROM test_ids)
  OR NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids)) THEN
  RAISE EXCEPTION 'FAIL own driver lookup or GPS'; END IF;
END $$;
RESET ROLE;
UPDATE public.profiles SET is_active=false WHERE id=(SELECT driver_user FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF private.current_driver_id() IS NOT NULL OR EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids)) THEN
  RAISE EXCEPTION 'FAIL inactive driver access'; END IF;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims',json_build_object('sub',other_customer,'role','authenticated',
 'user_metadata',json_build_object('role','SUPER_ADMIN'))::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF private.current_driver_id() IS NOT NULL OR EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids))
  OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)) THEN
  RAISE EXCEPTION 'FAIL unrelated customer or editable metadata escalated'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.companies(name,slug) SELECT 'Scale policy isolation','scale-policy-'||company FROM test_ids;
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT id FROM public.companies WHERE slug='scale-policy-'||(SELECT company::text FROM test_ids))
 WHERE id=(SELECT other_customer FROM test_ids);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids))
  OR EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)) THEN
  RAISE EXCEPTION 'FAIL other company admin access'; END IF;
END $$;
RESET ROLE;
UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=(SELECT company FROM test_ids) WHERE id=(SELECT customer FROM test_ids);
SELECT set_config('request.jwt.claims',json_build_object('sub',customer,'role','authenticated')::text,true) FROM test_ids;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.driver_locations WHERE driver_id=(SELECT driver FROM test_ids))
  OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=(SELECT request FROM test_ids)) THEN
  RAISE EXCEPTION 'FAIL own company admin access'; END IF;
END $$;
RESET ROLE;
ROLLBACK TO SAVEPOINT scale_policy_suite;
RELEASE SAVEPOINT scale_policy_suite;
SELECT 'PASS: cached driver identity, inactive accounts, editable claims, own and foreign company admin isolation' AS result;
