-- Public merchant configuration for the owning customer only. No Session,
-- secret, Stripe Customer, order or monetary state is created by this read.
CREATE OR REPLACE FUNCTION private.ride_payment_state(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE r public.taxi_requests;m private.ride_stripe_merchants;eligible boolean:=false;environment text;
BEGIN
 SELECT * INTO r FROM public.taxi_requests WHERE id=p_request_id;
 IF NOT FOUND OR auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active)
  OR NOT(r.customer_id=auth.uid() OR public.is_driver(r.driver_id) OR public.is_company_admin(r.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Ride not allowed' USING ERRCODE='42501';END IF;
 SELECT merchant.* INTO m FROM private.ride_stripe_merchants merchant JOIN public.companies c ON c.id=r.company_id
  WHERE merchant.enabled AND (c.id=merchant.root_company_id OR c.parent_company_id=merchant.root_company_id) AND lower(c.currency)='eur';
 IF FOUND THEN eligible:=(m.livemode OR EXISTS(SELECT 1 FROM private.ride_stripe_test_customers t WHERE t.customer_id=r.customer_id AND t.root_company_id=m.root_company_id AND t.enabled));END IF;
 environment:=CASE WHEN r.payment_environment='test' OR eligible AND NOT m.livemode THEN 'test' ELSE 'live' END;
 eligible:=eligible AND r.payment_status='pending' AND r.status IN ('accepted','arrived','in_progress');
 RETURN jsonb_build_object('request_id',r.id,'eligible',eligible,'inline_available',eligible AND m.publishable_key IS NOT NULL,'preparation',CASE WHEN eligible AND m.publishable_key IS NOT NULL AND r.customer_id=auth.uid() THEN jsonb_build_object('account_id',m.account_id,'publishable_key',m.publishable_key,'environment',environment) ELSE NULL END,'environment',environment,'ended_at',r.trip_ended_at,'amount',coalesce(r.final_price,r.estimated_price),'state',r.online_payment_state,'payment_status',r.payment_status,'payment_method',r.payment_method);
END $function$
;
NOTIFY pgrst,'reload schema';

