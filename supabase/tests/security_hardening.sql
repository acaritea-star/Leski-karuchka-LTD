BEGIN;
DO $test$
DECLARE name text; role_name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['app_config','audit_log','driver_documents','driver_locations','ledger','notifications',
  'payment_transactions','profiles','push_subscriptions','saved_places','taxi_requests','trips'] LOOP
  IF has_table_privilege('anon','public.'||name,'SELECT') THEN RAISE EXCEPTION 'FAIL anon SELECT on %',name; END IF;
  IF NOT has_table_privilege('authenticated','public.'||name,'SELECT') OR
     NOT has_table_privilege('service_role','public.'||name,'SELECT') THEN RAISE EXCEPTION 'FAIL normal read rights changed on %',name; END IF;
  IF has_table_privilege('anon','public.'||name,'MAINTAIN') OR has_table_privilege('authenticated','public.'||name,'MAINTAIN') THEN
   RAISE EXCEPTION 'FAIL maintenance permission on %',name; END IF;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN EXECUTE format('SELECT 1 FROM public.%I LIMIT 1',name);
   RAISE EXCEPTION 'FAIL anonymous query allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
 END LOOP;
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF has_function_privilege(role_name,'public.read_push_vapid_keys()','EXECUTE') OR
   has_function_privilege(role_name,'public.read_landing_stats()','EXECUTE') THEN RAISE EXCEPTION 'FAIL server-only RPC exposed'; END IF;
 END LOOP;
END $test$;
-- Public content still works through its actual policies and role helpers.
INSERT INTO public.news_articles(title,slug,excerpt,content,status,published_at)
 VALUES('Synthetic security news','security-'||gen_random_uuid(),'test','test','published',now());
SET LOCAL ROLE anon;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.news_articles WHERE title='Synthetic security news') THEN
 RAISE EXCEPTION 'FAIL public news broken'; END IF; END $$;
RESET ROLE;
-- Test the changed defaults, without granting access to these canary objects.
CREATE TABLE public.security_default_canary(id integer);
CREATE FUNCTION public.security_default_canary() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION private.security_default_canary() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
DO $$ BEGIN
 IF has_table_privilege('anon','public.security_default_canary','SELECT') OR
 has_table_privilege('authenticated','public.security_default_canary','SELECT') OR
 has_function_privilege('anon','public.security_default_canary()','EXECUTE') OR
 has_function_privilege('authenticated','public.security_default_canary()','EXECUTE') OR
 has_function_privilege('anon','private.security_default_canary()','EXECUTE') THEN RAISE EXCEPTION 'FAIL implicit future access'; END IF;
END $$;
-- Warm and expired cache behavior with the real service-only RPC.
UPDATE private.landing_stats_cache SET payload='{"completed_trips":123456,"avg_rating":4.8}',refreshed_at=clock_timestamp();
SET LOCAL ROLE service_role;
DO $$ BEGIN IF public.read_landing_stats()->>'completed_trips'<>'123456' THEN RAISE EXCEPTION 'FAIL cache miss'; END IF; END $$;
RESET ROLE;
UPDATE private.landing_stats_cache SET refreshed_at=clock_timestamp()-interval '61 seconds';
SET LOCAL ROLE service_role;
DO $$ BEGIN IF public.read_landing_stats()->>'completed_trips'='123456' THEN RAISE EXCEPTION 'FAIL cache did not refresh'; END IF; END $$;
RESET ROLE;
\ir ../../deployment/security/anon-select-rollback.sql
DO $$ BEGIN IF NOT has_table_privilege('anon','public.profiles','SELECT') THEN RAISE EXCEPTION 'FAIL rollback'; END IF; END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.profiles) THEN RAISE EXCEPTION 'FAIL RLS after rollback'; END IF; END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: sensitive access denied, signed-in grants preserved, public news, future defaults, shared cache, rollback' AS result;
