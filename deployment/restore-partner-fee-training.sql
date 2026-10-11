-- Restore version selection only. Never remove accepted documents or receipts.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE private.driver_policy_versions IN EXCLUSIVE MODE;
DO $guard$
BEGIN
 IF (SELECT count(*) FROM private.driver_policy_versions WHERE is_current)<>1
 OR NOT EXISTS(SELECT 1 FROM private.driver_policy_versions WHERE is_current
  AND terms_version='2026-10-11-driver.1' AND training_version='2026-10-11.1'
  AND content_hash='f2f994314fedf8d908b2ea1bbaa40268bc2ba58f4492ea6c066194930e4fd367') THEN RAISE EXCEPTION 'Unexpected current version; restore aborted.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM private.driver_policy_versions WHERE terms_version='2026-10-09-driver.1'
  AND training_version='2026-10-09.1' AND content_hash='5f4e2d7898ff8ca7197dc7929453db805b77cd88b501f8e8fc6a62f1f46f6d53') THEN RAISE EXCEPTION 'Prior document missing; restore aborted.'; END IF;
END $guard$;
UPDATE private.driver_policy_versions SET is_current=false WHERE is_current;
UPDATE private.driver_policy_versions SET is_current=true
 WHERE terms_version='2026-10-09-driver.1' AND training_version='2026-10-09.1';
COMMIT;
