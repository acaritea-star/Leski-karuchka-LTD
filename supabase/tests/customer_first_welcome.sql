BEGIN;
SELECT set_config('request.jwt.claims','{}',true);
DO $test$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); staff uuid:=gen_random_uuid(); inactive uuid:=gen_random_uuid();
BEGIN
 INSERT INTO auth.users(id,email) SELECT id,'welcome-'||id||'@example.invalid' FROM unnest(ARRAY[a,b,staff,inactive])id;
 UPDATE public.profiles SET role='SUPER_ADMIN' WHERE id=staff;
 UPDATE public.profiles SET is_active=false WHERE id=inactive;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF NOT public.claim_customer_welcome() OR public.claim_customer_welcome() THEN RAISE EXCEPTION 'FAIL welcome not first-only'; END IF;
 BEGIN
  DELETE FROM private.customer_welcome_seen WHERE user_id=a;
  RAISE EXCEPTION 'FAIL client reset own welcome';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 IF NOT EXISTS(SELECT 1 FROM private.customer_welcome_seen WHERE user_id=a)
 OR EXISTS(SELECT 1 FROM private.customer_welcome_seen WHERE user_id=b) THEN RAISE EXCEPTION 'FAIL welcome account isolation'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',b,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF NOT public.claim_customer_welcome() THEN RAISE EXCEPTION 'FAIL customer B lost first welcome'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF public.claim_customer_welcome() THEN RAISE EXCEPTION 'FAIL relogin/device repeated welcome'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',staff,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF public.claim_customer_welcome() THEN RAISE EXCEPTION 'FAIL staff welcome'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',inactive,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 IF public.claim_customer_welcome() THEN RAISE EXCEPTION 'FAIL inactive welcome'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 SET LOCAL ROLE anon;
 BEGIN
  PERFORM public.claim_customer_welcome();
  RAISE EXCEPTION 'FAIL anonymous welcome claim allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
END $test$;
ROLLBACK;
SELECT 'PASS: first customer welcome, repeat login/device, private reset denied, account/role isolation' AS result;
