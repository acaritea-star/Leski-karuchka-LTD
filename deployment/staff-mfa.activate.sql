-- Run only after publishing the new MFA frontend and verifying its release.
-- Existing staff sessions must complete TOTP before further application access.
BEGIN;
UPDATE private.app_security SET staff_mfa_enforced=true,changed_at=statement_timestamp() WHERE singleton;
COMMIT;
