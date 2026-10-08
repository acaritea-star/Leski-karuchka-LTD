-- Review before execution. Exact pre-audit definitions; no user rows are changed.
BEGIN;
SET LOCAL lock_timeout='3s';
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_user_endpoint ON public.push_subscriptions(user_id,endpoint);
ALTER POLICY "payment_transactions_select_customer" ON "public"."payment_transactions"
 USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.id = payment_transactions.request_id) AND (tr.customer_id = auth.uid())))));

ALTER POLICY "ratings_select_customer" ON "public"."ratings"
 USING ((customer_id = auth.uid()));

ALTER POLICY "saved_places_select_own" ON "public"."saved_places"
 USING ((user_id = auth.uid()));

ALTER POLICY "saved_places_insert_own" ON "public"."saved_places"
 WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "saved_places_update_own" ON "public"."saved_places"
 USING ((user_id = auth.uid()))
 WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "saved_places_delete_own" ON "public"."saved_places"
 USING ((user_id = auth.uid()));

ALTER POLICY "push_subscriptions_delete_own" ON "public"."push_subscriptions"
 USING ((auth.uid() = user_id));

ALTER POLICY "audit_log_select_admin" ON "public"."audit_log"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = audit_log.company_id)))))));

ALTER POLICY "ledger_select_admin" ON "public"."ledger"
 USING ((EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = auth.uid()) AND (((p.role)::text = 'SUPER_ADMIN'::text) OR (((p.role)::text = 'COMPANY_ADMIN'::text) AND (p.company_id = ledger.company_id)))))));

ALTER POLICY "push_subscriptions_select_own" ON "public"."push_subscriptions"
 USING ((auth.uid() = user_id));

ALTER POLICY "push_subscriptions_insert_own" ON "public"."push_subscriptions"
 WITH CHECK ((auth.uid() = user_id));

ALTER POLICY "push_subscriptions_update_own" ON "public"."push_subscriptions"
 USING ((auth.uid() = user_id))
 WITH CHECK ((auth.uid() = user_id));

ALTER POLICY "vehicles_select_trip_party" ON "public"."vehicles"
 USING ((EXISTS ( SELECT 1
   FROM (drivers d
     JOIN taxi_requests r ON ((r.driver_id = d.id)))
  WHERE ((d.vehicle_id = vehicles.id) AND (r.customer_id = auth.uid())))));
COMMIT;

