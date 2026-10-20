-- Account-level, at-most-once welcome. Existing customers keep their current flow.
BEGIN;
CREATE TABLE private.customer_welcome_seen (
 user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
 seen_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL DEFAULT 'first_login' CHECK(reason IN ('first_login','existing_customer'))
);
ALTER TABLE private.customer_welcome_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.customer_welcome_seen FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO private.customer_welcome_seen(user_id,reason)
 SELECT id,'existing_customer' FROM public.profiles WHERE role='CUSTOMER'
 ON CONFLICT(user_id) DO NOTHING;

CREATE FUNCTION private.claim_customer_welcome() RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE uid uuid:=auth.uid(); claimed integer;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND role='CUSTOMER' AND is_active) THEN RETURN false; END IF;
 INSERT INTO private.customer_welcome_seen(user_id) VALUES(uid) ON CONFLICT(user_id) DO NOTHING;
 GET DIAGNOSTICS claimed=ROW_COUNT;
 RETURN claimed=1;
END $fn$;
CREATE FUNCTION public.claim_customer_welcome() RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
 SELECT private.claim_customer_welcome();
$fn$;
REVOKE ALL ON FUNCTION private.claim_customer_welcome(),public.claim_customer_welcome() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.claim_customer_welcome(),public.claim_customer_welcome() TO authenticated;
COMMIT;
