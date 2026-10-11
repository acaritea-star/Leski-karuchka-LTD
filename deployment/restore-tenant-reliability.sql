-- Restore the matching previous frontend with this compatibility rollback.
BEGIN;
SET LOCAL lock_timeout='2s';
CREATE OR REPLACE FUNCTION private.resolve_partner_access(p_kind text,p_invitation uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); p public.profiles; i public.partner_invitations; e text; c uuid; a uuid; destination text;
BEGIN
 IF p_kind IS NULL OR p_kind NOT IN ('any','company','driver') THEN RAISE EXCEPTION 'Невалиден вход.'; END IF;
 SELECT * INTO p FROM public.profiles WHERE id=u FOR UPDATE;
 IF NOT FOUND OR NOT p.is_active THEN RAISE EXCEPTION 'Необходим е активен профил.' USING ERRCODE='42501'; END IF;
 -- Global administrators never become company administrators through an invitation.
 IF p.role='SUPER_ADMIN' THEN RETURN jsonb_build_object('status','ready','destination','/admin/companies','role',p.role,'company_id',p.company_id); END IF;
 IF p.role='DRIVER' THEN RETURN jsonb_build_object('status','ready','destination','/driver/home','role',p.role,'company_id',p.company_id); END IF;
 IF p.role='COMPANY_ADMIN' AND p.company_id IS NOT NULL THEN
  SELECT CASE WHEN setup_completed_at IS NULL THEN '/company/setup' ELSE '/admin/dashboard' END INTO destination FROM public.companies WHERE id=p.company_id;
  IF destination IS NOT NULL THEN RETURN jsonb_build_object('status','ready','destination',destination,'role',p.role,'company_id',p.company_id,'application_id',NULL,'company_name',(SELECT name FROM public.companies WHERE id=p.company_id)); END IF;
 END IF;
 SELECT lower(email) INTO e FROM auth.users WHERE id=u AND email_confirmed_at IS NOT NULL;
 -- Trust auth.users, never a client-supplied email, editable profile or JWT metadata.
 IF e IS NULL OR e='' THEN
  IF p_kind='any' AND p_invitation IS NULL THEN RETURN jsonb_build_object('status','ready','destination','/customer/home','role',p.role); END IF;
  RETURN jsonb_build_object('status','denied','reason','missing_email','message','Този вход не предостави потвърден имейл. Използвайте Google с поканения имейл или поискайте нова покана от фирмата.');
 END IF;
 IF p_invitation IS NOT NULL THEN
  SELECT * INTO i FROM public.partner_invitations WHERE id=p_invitation AND email=e AND (p_kind='any' OR kind=p_kind) FOR UPDATE;
 ELSE
  SELECT * INTO i FROM public.partner_invitations WHERE email=e AND (p_kind='any' OR kind=p_kind)
   AND (status='pending' AND expires_at>clock_timestamp() OR status='accepted' AND accepted_by=u)
   ORDER BY (status='pending') DESC,created_at DESC LIMIT 1 FOR UPDATE;
 END IF;
 IF i.id IS NULL OR i.status='revoked' OR (i.status='pending' AND i.expires_at<=clock_timestamp()) OR (i.status='accepted' AND i.accepted_by<>u) THEN
  -- Historical applications remain finishable; the public company UUID no longer grants new candidacy.
  IF p_invitation IS NULL AND p_kind IN ('any','driver') AND p.role='CUSTOMER' THEN
   SELECT id,company_id INTO a,c FROM public.driver_applications WHERE user_id=u AND status IN ('pending','rejected');
   IF a IS NOT NULL THEN RETURN jsonb_build_object('status','preparation','destination','/driver/access','role',p.role,'company_id',c,'application_id',a,'company_name',(SELECT name FROM public.companies WHERE id=c)); END IF;
  END IF;
  IF p_kind='any' AND p_invitation IS NULL AND p.role='CUSTOMER' THEN RETURN jsonb_build_object('status','ready','destination','/customer/home','role',p.role); END IF;
  RETURN jsonb_build_object('status','denied','reason','invitation_required','message','Няма валидна покана за този акаунт. Влезте с точния поканен имейл или поискайте нова покана.');
 END IF;
 c:=i.company_id;
 IF i.kind='company' THEN
  IF p.role NOT IN ('CUSTOMER','COMPANY_ADMIN') OR EXISTS(SELECT 1 FROM public.driver_applications WHERE user_id=u AND status='pending') THEN
   RAISE EXCEPTION 'Профилът вече е включен в друг партньорски процес.' USING ERRCODE='42501'; END IF;
  IF c IS NULL THEN
   c:=gen_random_uuid();
   INSERT INTO public.companies(id,name,slug,email,is_active,document_checks_required) VALUES(c,'Нова фирма','company-'||c::text,e,false,true);
  END IF;
  UPDATE public.profiles SET role='COMPANY_ADMIN',company_id=c,updated_at=clock_timestamp() WHERE id=u;
  SELECT CASE WHEN setup_completed_at IS NULL THEN '/company/setup' ELSE '/admin/dashboard' END INTO destination FROM public.companies WHERE id=c;
 ELSE
  IF p.role<>'CUSTOMER' OR NOT EXISTS(SELECT 1 FROM public.companies WHERE id=c AND is_active AND setup_completed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Фирмата или профилът не е готов за тази покана.' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_applications WHERE user_id=u AND company_id<>c AND status='pending') THEN
   RAISE EXCEPTION 'Има незавършена кандидатура към друга фирма.'; END IF;
  SELECT id INTO a FROM public.driver_applications WHERE user_id=u AND company_id=c;
  destination:='/driver/access';
 END IF;
 IF i.status='pending' THEN
  UPDATE public.partner_invitations SET status='accepted',accepted_by=u,accepted_at=clock_timestamp(),company_id=c WHERE id=i.id;
  INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(c,u,'partner_invitation',i.id,'invitation_accepted');
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN i.kind='driver' THEN 'preparation' ELSE 'ready' END,'destination',destination,
  'role',CASE WHEN i.kind='company' THEN 'COMPANY_ADMIN' ELSE p.role::text END,'company_id',c,'application_id',a,'company_name',(SELECT name FROM public.companies WHERE id=c));
END $fn$;

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


CREATE OR REPLACE FUNCTION public.company_dashboard(p_company_id uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $function$
DECLARE anchor date:=coalesce(p_day,(current_timestamp AT TIME ZONE 'Europe/Sofia')::date); result jsonb;
BEGIN
 IF p_company_id IS NULL OR (SELECT auth.uid()) IS NULL
  OR NOT ((SELECT public.is_company_admin(p_company_id)) OR (SELECT public.is_super_admin())) THEN
  RAISE EXCEPTION 'Dashboard scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH driver_totals AS (
  SELECT count(*) AS total,count(*) FILTER(WHERE is_online) AS online
  FROM public.drivers WHERE company_id=p_company_id
 ), request_totals AS (
  SELECT count(*) FILTER(WHERE status IN ('accepted','arrived','in_progress')
    OR status='pending' AND coalesce(expires_at,created_at+interval '2 minutes')>current_timestamp) AS active,
   count(*) FILTER(WHERE status='completed') AS completed,count(*) FILTER(WHERE status='cancelled') AS cancelled,
   coalesce(sum(coalesce(final_price,estimated_price,0)) FILTER(WHERE status='completed'),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id
 ), dates AS (
  SELECT anchor-6+n AS day FROM generate_series(0,6) AS s(n)
 ), daily AS (
  SELECT (completed_at AT TIME ZONE 'Europe/Sofia')::date AS day,count(*) AS orders,
   coalesce(sum(coalesce(final_price,estimated_price,0)),0) AS revenue
  FROM public.taxi_requests WHERE company_id=p_company_id AND status='completed'
   AND completed_at>=((anchor-6)::timestamp AT TIME ZONE 'Europe/Sofia')
   AND completed_at<((anchor+1)::timestamp AT TIME ZONE 'Europe/Sofia')
  GROUP BY 1
 )
 SELECT jsonb_build_object('stats',jsonb_build_object(
  'totalDrivers',d.total,'onlineDrivers',d.online,'activeOrders',r.active,
  'completedOrders',r.completed,'cancelledOrders',r.cancelled,'totalRevenue',r.revenue),
  'days',(SELECT jsonb_agg(jsonb_build_object('day',dates.day,'orders',coalesce(daily.orders,0),
   'revenue',coalesce(daily.revenue,0)) ORDER BY dates.day) FROM dates LEFT JOIN daily USING(day)))
 INTO result FROM driver_totals d CROSS JOIN request_totals r;
 RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.company_dashboard(uuid,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.company_dashboard(uuid,date) TO authenticated;


DROP FUNCTION IF EXISTS public.company_driver_page(uuid,text,integer);
DROP FUNCTION IF EXISTS private.fleet_online(boolean,boolean,timestamptz,timestamptz,timestamptz);
DROP INDEX IF EXISTS public.drivers_company_created_id_idx;
COMMIT;
