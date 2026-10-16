-- Emergency rollback of enforcement, retaining all factors, audit data and rules.
BEGIN;
UPDATE private.app_security SET staff_mfa_enforced=false,changed_at=statement_timestamp() WHERE singleton;
COMMIT;
