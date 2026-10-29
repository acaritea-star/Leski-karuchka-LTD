-- Not an automatic application migration. Run as the managed object's owner,
-- after recording ACLs. Production postgres cannot apply this today.
DO $owner_check$
BEGIN
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AND (
  NOT pg_has_role(current_user,(SELECT nspowner FROM pg_namespace WHERE nspname='net'),'USAGE') OR
  EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net'
   AND NOT pg_has_role(current_user,p.proowner,'USAGE')) OR
  EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='net'
   AND NOT pg_has_role(current_user,c.relowner,'USAGE'))
 ) THEN RAISE EXCEPTION 'net owner privileges required; no changes applied' USING ERRCODE='42501'; END IF;
END $owner_check$;
REVOKE ALL ON SCHEMA net FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA net TO postgres,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA net FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA net FROM PUBLIC,anon,authenticated;
-- Preserve the postgres-owned dispatcher and owner maintenance operations.
GRANT ALL ON ALL FUNCTIONS IN SCHEMA net TO postgres;
GRANT ALL ON ALL TABLES IN SCHEMA net TO postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA net TO postgres;
