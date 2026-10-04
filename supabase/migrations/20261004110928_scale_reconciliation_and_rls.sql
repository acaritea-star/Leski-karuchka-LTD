-- Keep dispatch eligibility and RLS ownership unchanged while avoiding repeated lookups.
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION private.current_driver_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $function$
 SELECT d.id FROM public.drivers d JOIN public.profiles p ON p.id=d.user_id
 WHERE p.id=(SELECT auth.uid()) AND p.role='DRIVER' AND p.is_active;
$function$;
REVOKE ALL ON FUNCTION private.current_driver_id() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION private.current_driver_id() TO authenticated;

ALTER POLICY "driver_locations_insert_own" ON public."driver_locations" WITH CHECK ((driver_id=(SELECT private.current_driver_id())));
ALTER POLICY "driver_locations_select_admin" ON public."driver_locations" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "driver_locations_select_customer" ON public."driver_locations" USING ((EXISTS ( SELECT 1
   FROM taxi_requests tr
  WHERE ((tr.driver_id = driver_locations.driver_id) AND (tr.customer_id = (SELECT auth.uid())) AND (tr.status <> ALL (ARRAY['completed'::request_status, 'cancelled'::request_status]))))));
ALTER POLICY "driver_locations_select_driver" ON public."driver_locations" USING ((driver_id=(SELECT private.current_driver_id())));
ALTER POLICY "driver_locations_update_own" ON public."driver_locations" USING ((driver_id=(SELECT private.current_driver_id()))) WITH CHECK ((driver_id=(SELECT private.current_driver_id())));
ALTER POLICY "drivers_delete_admin" ON public."drivers" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "drivers_insert_admin" ON public."drivers" WITH CHECK ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "drivers_select_admin" ON public."drivers" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "drivers_select_authenticated" ON public."drivers" USING ((EXISTS ( SELECT 1
   FROM taxi_requests r
  WHERE ((r.driver_id = drivers.id) AND (r.customer_id = ( SELECT (SELECT auth.uid()) AS uid)) AND (r.status = ANY (ARRAY['accepted'::request_status, 'arrived'::request_status, 'in_progress'::request_status]))))));
ALTER POLICY "drivers_select_own" ON public."drivers" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "drivers_update_admin" ON public."drivers" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin()))) WITH CHECK ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "drivers_update_own" ON public."drivers" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "notifications_insert_admin" ON public."notifications" WITH CHECK ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "notifications_select_admin" ON public."notifications" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "notifications_select_own" ON public."notifications" USING ((user_id = (SELECT auth.uid())));
ALTER POLICY "notifications_update_own" ON public."notifications" USING ((user_id = (SELECT auth.uid()))) WITH CHECK ((user_id = (SELECT auth.uid())));
ALTER POLICY "profiles_select_admin_company" ON public."profiles" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "profiles_select_own" ON public."profiles" USING ((id = (SELECT auth.uid())));
ALTER POLICY "profiles_select_trip_party" ON public."profiles" USING ((EXISTS ( SELECT 1
   FROM (taxi_requests r
     JOIN drivers d ON ((d.id = r.driver_id)))
  WHERE (((r.customer_id = (SELECT auth.uid())) AND (d.user_id = profiles.id)) OR ((d.user_id = (SELECT auth.uid())) AND (r.customer_id = profiles.id))))));
ALTER POLICY "profiles_update_admin_company" ON public."profiles" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin()))) WITH CHECK ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "profiles_update_own" ON public."profiles" USING ((id = (SELECT auth.uid()))) WITH CHECK ((id = (SELECT auth.uid())));
ALTER POLICY "taxi_requests_select_customer" ON public."taxi_requests" USING ((customer_id = (SELECT auth.uid())));
ALTER POLICY "taxi_requests_select_driver" ON public."taxi_requests" USING (((driver_id=(SELECT private.current_driver_id())) OR is_company_admin(company_id) OR (SELECT public.is_super_admin()) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude))));
ALTER POLICY "taxi_requests_update_admin" ON public."taxi_requests" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin()))) WITH CHECK ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "taxi_requests_update_customer" ON public."taxi_requests" USING ((customer_id = (SELECT auth.uid()))) WITH CHECK ((customer_id = (SELECT auth.uid())));
ALTER POLICY "taxi_requests_update_driver" ON public."taxi_requests" USING (((driver_id=(SELECT private.current_driver_id())) OR ((status = 'pending'::request_status) AND (clock_timestamp() < COALESCE(expires_at, (created_at + '00:02:00'::interval))) AND private.can_receive_request(company_id, vehicle_type_id, pickup_latitude, pickup_longitude)))) WITH CHECK (((driver_id=(SELECT private.current_driver_id())) OR is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "trips_select_admin" ON public."trips" USING ((is_company_admin(company_id) OR (SELECT public.is_super_admin())));
ALTER POLICY "trips_select_customer" ON public."trips" USING ((customer_id = (SELECT auth.uid())));
ALTER POLICY "trips_select_driver" ON public."trips" USING ((driver_id=(SELECT private.current_driver_id())));

CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications(user_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS requests_driver_completed_idx ON public.taxi_requests(driver_id,completed_at DESC) WHERE status='completed';
CREATE INDEX IF NOT EXISTS driver_locations_company_idx ON public.driver_locations(company_id);
CREATE INDEX IF NOT EXISTS requests_vehicle_type_idx ON public.taxi_requests(vehicle_type_id);

