-- Bounded, invoker-rights reads: never bypass row-level security.
CREATE OR REPLACE FUNCTION public.company_customers(p_company uuid, p_search text DEFAULT '', p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result jsonb; term text:=btrim(coalesce(p_search,''));
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Customer report scope not allowed' USING ERRCODE='42501';
 END IF;
 IF p_page IS NULL OR p_page<0 OR p_page>10000 OR length(term)>80 THEN
   RAISE EXCEPTION 'Invalid customer report page' USING ERRCODE='22023';
 END IF;
 WITH matching AS MATERIALIZED (
   SELECT p.id,p.first_name,p.last_name,p.phone,p.avatar_url,p.created_at
   FROM public.profiles p WHERE p.company_id=p_company AND p.role='CUSTOMER'
    AND (term='' OR strpos(lower(concat_ws(' ',p.first_name,p.last_name)),lower(term))>0)
 ), page AS (
   SELECT * FROM matching ORDER BY created_at DESC,id DESC LIMIT 50 OFFSET p_page*50
 ), rows AS (
   SELECT p.*,totals.trips AS "totalTrips",totals.amount AS "totalSpent"
   FROM page p CROSS JOIN LATERAL (
     SELECT count(*) trips,coalesce(sum(coalesce(r.final_price,r.estimated_price,0)),0) amount
     FROM public.taxi_requests r WHERE r.company_id=p_company AND r.customer_id=p.id AND r.status='completed'
   ) totals
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM matching),
   'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC) FROM rows r),'[]'::jsonb)) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.company_customers(uuid,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_customers(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.company_fleet(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE result jsonb;
BEGIN
 IF p_company IS NULL OR (SELECT auth.uid()) IS NULL OR NOT
   ((SELECT public.is_company_admin(p_company)) OR (SELECT public.is_super_admin())) THEN
   RAISE EXCEPTION 'Fleet scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH visible AS MATERIALIZED (
   SELECT d.id,p.first_name,p.last_name,d.is_online,l.latitude,l.longitude,l.updated_at,l.position_at
   FROM public.driver_locations l JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=p_company
   JOIN public.profiles p ON p.id=d.user_id
   WHERE l.company_id=p_company
 ), page AS (
   SELECT * FROM visible ORDER BY is_online DESC,updated_at DESC,id LIMIT 500
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM visible),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.is_online DESC,p.updated_at DESC,p.id) FROM page p),'[]'::jsonb)) INTO result;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION public.company_fleet(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_fleet(uuid) TO authenticated;

-- Leading columns match report filters, ownership checks and customer lookup.
CREATE INDEX IF NOT EXISTS outcomes_driver_id_time ON public.request_outcomes(driver_id,occurred_at DESC,id);
CREATE INDEX IF NOT EXISTS money_driver_id_time ON public.driver_money_entries(driver_id,recorded_at DESC,id);
CREATE INDEX IF NOT EXISTS saved_places_user_id_idx ON public.saved_places(user_id);
CREATE INDEX IF NOT EXISTS ratings_customer_id_idx ON public.ratings(customer_id);
CREATE INDEX IF NOT EXISTS requests_company_customer_completed_idx ON public.taxi_requests(company_id,customer_id) WHERE status='completed';

NOTIFY pgrst,'reload schema';

-- Only statement-constant auth.uid() calls change; ownership expressions and roles are retained.
-- The second unique index remains attached to its UNIQUE constraint.
DROP INDEX IF EXISTS public.idx_push_subscriptions_user_endpoint;
ALTER POLICY "payment_transactions_select_customer" ON "public"."payment_transactions"
 USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.id = payment_transactions.request_id) AND (tr.customer_id = (select auth.uid()))))));

ALTER POLICY "ratings_select_customer" ON "public"."ratings"
 USING ((customer_id = (select auth.uid())));

ALTER POLICY "saved_places_select_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_insert_own" ON "public"."saved_places"
 WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_update_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())))
 WITH CHECK ((user_id = (select auth.uid())));

ALTER POLICY "saved_places_delete_own" ON "public"."saved_places"
 USING ((user_id = (select auth.uid())));

ALTER POLICY "push_subscriptions_delete_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id));

ALTER POLICY "audit_log_select_admin" ON "public"."audit_log"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = audit_log.company_id)))))));

ALTER POLICY "ledger_select_admin" ON "public"."ledger"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = (select auth.uid())) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = ledger.company_id)))))));

ALTER POLICY "push_subscriptions_select_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id));

ALTER POLICY "push_subscriptions_insert_own" ON "public"."push_subscriptions"
 WITH CHECK (((select auth.uid()) = user_id));

ALTER POLICY "push_subscriptions_update_own" ON "public"."push_subscriptions"
 USING (((select auth.uid()) = user_id))
 WITH CHECK (((select auth.uid()) = user_id));

ALTER POLICY "vehicles_select_trip_party" ON "public"."vehicles"
 USING ((EXISTS ( SELECT 1
   FROM (drivers d
     JOIN taxi_requests r ON ((r.driver_id = d.id)))
  WHERE ((d.vehicle_id = vehicles.id) AND (r.customer_id = (select auth.uid()))))));


