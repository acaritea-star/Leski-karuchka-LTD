GRANT SELECT ON TABLE public.app_config,public.audit_log,public.driver_documents,
 public.driver_locations,public.ledger,public.notifications,public.payment_transactions,
 public.profiles,public.push_subscriptions,public.saved_places,public.taxi_requests,public.trips TO anon;
-- RLS continues to deny anonymous records. Other hardening remains in place.
