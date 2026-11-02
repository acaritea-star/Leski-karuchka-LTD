-- Preserve authenticated/service access and every existing RLS policy.
REVOKE SELECT ON TABLE public.app_config, public.audit_log,
 public.driver_documents, public.driver_locations, public.ledger,
 public.notifications, public.payment_transactions, public.profiles,
 public.push_subscriptions, public.saved_places, public.taxi_requests,
 public.trips FROM anon;

-- Managed extension objects require their owner; do not modify those here.
DO $hardening$
DECLARE target regclass;
BEGIN
 FOR target IN SELECT c.oid::regclass FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p')
 AND c.relowner='postgres'::regrole
 AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
   AND d.objid=c.oid AND d.deptype='e')
 LOOP
  EXECUTE format('REVOKE MAINTAIN ON TABLE %s FROM PUBLIC,anon,authenticated',target);
 END LOOP;
END $hardening$;

-- Future objects require intentional grants. Existing RPC helpers are intact.
-- PUBLIC's default function grant is global, so revoke it at that level.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon,authenticated;
