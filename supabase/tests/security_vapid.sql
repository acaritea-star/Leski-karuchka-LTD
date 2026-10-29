BEGIN;
-- Synthetic values only. No external provider requests are made here.
INSERT INTO public.app_config(id,vapid_public_key,vapid_private_key) VALUES(1,'synthetic-public','synthetic-private')
 ON CONFLICT(id) DO UPDATE SET vapid_public_key=excluded.vapid_public_key,vapid_private_key=excluded.vapid_private_key;
SET LOCAL ROLE service_role;
DO $$ BEGIN IF public.read_push_vapid_keys()->>'privateKey'<>'synthetic-private' THEN RAISE EXCEPTION 'FAIL legacy fallback'; END IF; END $$;
RESET ROLE;
\ir ../../deployment/security/vapid-cutover.sql
\ir ../../deployment/security/vapid-cutover.sql
DO $$ BEGIN IF (SELECT vapid_private_key FROM public.app_config WHERE id=1) IS NOT NULL THEN RAISE EXCEPTION 'FAIL legacy private copy remains'; END IF; END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN IF public.read_push_vapid_keys()<>'{"publicKey":"synthetic-public","privateKey":"synthetic-private"}'::jsonb THEN RAISE EXCEPTION 'FAIL pair changed'; END IF; END $$;
RESET ROLE;
\ir ../../deployment/security/vapid-rollback.sql
DO $$ BEGIN IF (SELECT vapid_private_key FROM public.app_config WHERE id=1)<>'synthetic-private' THEN RAISE EXCEPTION 'FAIL key rollback'; END IF; END $$;
DELETE FROM vault.secrets WHERE name='leski_vapid_private_key';
DO $$ BEGIN
 BEGIN PERFORM public.read_push_vapid_keys(); RAISE EXCEPTION 'FAIL partial Vault setup accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
ROLLBACK;
SELECT 'PASS: VAPID stable pair, private Vault storage, idempotent cutover, rollback, partial config rejection' AS result;
