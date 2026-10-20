-- Run only after the public frontend serves the verified RideCheckout build.
-- Idempotent configuration activation; no ride, money or receipt is rewritten.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';
DO $check$
BEGIN
 IF to_regprocedure('public.complete_ride_payment(uuid,uuid,uuid,text,numeric,text)') IS NULL
  OR to_regclass('public.ride_payment_receipts') IS NULL THEN
  RAISE EXCEPTION 'Checkout backend is not ready';
 END IF;
END $check$;
UPDATE private.app_security SET ride_payment_required=true,changed_at=statement_timestamp()
WHERE singleton AND NOT ride_payment_required;
SELECT staff_mfa_enforced,ride_payment_required FROM private.app_security WHERE singleton;
COMMIT;
