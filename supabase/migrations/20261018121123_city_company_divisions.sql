-- A city division is a separate operating tenant with an immutable parent.
-- Existing companies retain their membership, prices, requests and ledgers.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

ALTER TABLE public.companies
 ADD COLUMN parent_company_id uuid REFERENCES public.companies(id) ON DELETE RESTRICT,
 ADD COLUMN service_latitude double precision,
 ADD COLUMN service_longitude double precision,
 ADD COLUMN service_radius_km numeric(5,2),
 ADD COLUMN night_base_fare numeric(10,2),
 ADD COLUMN night_price_per_km numeric(10,2),
 ADD COLUMN night_price_per_minute numeric(10,2),
 ADD COLUMN night_min_fare numeric(10,2),
 ADD CONSTRAINT company_division_zone CHECK (
  (service_latitude IS NULL AND service_longitude IS NULL AND service_radius_km IS NULL)
  OR (service_latitude IS NOT NULL AND service_longitude IS NOT NULL AND service_radius_km IS NOT NULL
   AND private.in_bulgaria(service_latitude,service_longitude)
   AND service_radius_km BETWEEN 0.5 AND 30)),
 ADD CONSTRAINT company_division_city CHECK (parent_company_id IS NULL OR
  (parent_company_id<>id AND service_city IS NOT NULL AND length(btrim(service_city)) BETWEEN 2 AND 100
   AND service_latitude IS NOT NULL AND service_longitude IS NOT NULL AND service_radius_km IS NOT NULL)),
 ADD CONSTRAINT company_night_tariffs CHECK (
  (night_base_fare IS NULL AND night_price_per_km IS NULL AND night_price_per_minute IS NULL AND night_min_fare IS NULL)
  OR (night_base_fare IS NOT NULL AND night_price_per_km IS NOT NULL AND night_price_per_minute IS NOT NULL AND night_min_fare IS NOT NULL
   AND night_base_fare>=0 AND night_base_fare<'Infinity'::numeric
   AND night_price_per_km>=0 AND night_price_per_km<'Infinity'::numeric
   AND night_price_per_minute>=0 AND night_price_per_minute<'Infinity'::numeric
   AND night_min_fare>=0 AND night_min_fare<'Infinity'::numeric));
CREATE INDEX companies_parent ON public.companies(parent_company_id) WHERE parent_company_id IS NOT NULL;
CREATE UNIQUE INDEX companies_parent_city ON public.companies(parent_company_id,lower(btrim(service_city))) WHERE parent_company_id IS NOT NULL;
CREATE INDEX companies_division_centres ON public.companies USING gist
 ((public.st_setsrid(public.st_makepoint(service_longitude,service_latitude),4326)::public.geography))
 WHERE parent_company_id IS NOT NULL AND setup_completed_at IS NOT NULL;

CREATE FUNCTION private.guard_company_division() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF NEW.parent_company_id IS NOT NULL THEN
  NEW.service_city:=btrim(regexp_replace(NEW.service_city,'[[:space:]]+',' ','g'));
 END IF;
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.parent_company_id IS DISTINCT FROM OLD.parent_company_id) THEN
  RAISE EXCEPTION 'Фирмата и принадлежността на подразделението не могат да бъдат променяни.' USING ERRCODE='42501';
 END IF;
 IF NEW.parent_company_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM public.companies p WHERE p.id=NEW.parent_company_id AND p.parent_company_id IS NULL AND p.id<>NEW.id
 ) THEN RAISE EXCEPTION 'Подразделението трябва да принадлежи пряко към основна фирма.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION private.guard_company_division() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_company_division BEFORE INSERT OR UPDATE ON public.companies
 FOR EACH ROW EXECUTE FUNCTION private.guard_company_division();

CREATE OR REPLACE FUNCTION public.is_company_admin(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT private.staff_mfa_allowed() AND EXISTS(
  SELECT 1 FROM public.profiles p
  WHERE p.id=(SELECT auth.uid()) AND p.role='COMPANY_ADMIN' AND p.is_active
   AND (p.company_id=target_company OR EXISTS(
    SELECT 1 FROM public.companies child WHERE child.id=target_company AND child.parent_company_id=p.company_id)));
$f$;
CREATE OR REPLACE FUNCTION public.is_company_member(target_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT public.is_company_admin(target_company) OR (private.staff_mfa_allowed() AND EXISTS(
  SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='DRIVER'
   AND p.company_id=target_company AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=p.id AND d.company_id=p.company_id)));
$f$;
ALTER POLICY audit_log_select_admin ON public.audit_log USING(public.is_company_admin(company_id) OR (SELECT public.is_super_admin()));
ALTER POLICY ledger_select_admin ON public.ledger USING(public.is_company_admin(company_id) OR (SELECT public.is_super_admin()));

CREATE FUNCTION private.create_company_division(p_id uuid,p_parent uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE parent public.companies; child public.companies; city text; label text; lat double precision; lng double precision; radius numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_company_admin(p_parent) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Нямате достъп до основната фирма.' USING ERRCODE='42501'; END IF;
 SELECT * INTO parent FROM public.companies WHERE id=p_parent AND parent_company_id IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Нужна е основна фирма, към която да добавите подразделение.' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Невалидни данни за подразделението.'; END IF;
 city:=btrim(regexp_replace(coalesce(p_data->>'service_city',''),'[[:space:]]+',' ','g')); label:=btrim(coalesce(p_data->>'name',''));
 BEGIN lat:=(p_data->>'service_latitude')::double precision; lng:=(p_data->>'service_longitude')::double precision; radius:=(p_data->>'service_radius_km')::numeric;
 EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'Изберете валидна зона на обслужване.'; END;
 IF length(city) NOT BETWEEN 2 AND 100 OR length(label) NOT BETWEEN 2 AND 120 OR lat IS NULL OR lng IS NULL
  OR private.in_bulgaria(lat,lng) IS DISTINCT FROM true OR radius IS NULL OR radius NOT BETWEEN 0.5 AND 30 OR radius<>round(radius,2) THEN
  RAISE EXCEPTION 'Попълнете име, град и зона на обслужване в България (0,5–30 км).'; END IF;
 SELECT * INTO child FROM public.companies WHERE id=p_id;
 IF FOUND THEN
  IF (child.parent_company_id,child.name,child.service_city,child.service_latitude,child.service_longitude,child.service_radius_km)
    IS DISTINCT FROM (p_parent,label,city,lat,lng,radius) THEN RAISE EXCEPTION 'Подразделението не съответства на тази заявка.' USING ERRCODE='42501'; END IF;
  RETURN to_jsonb(child);
 END IF;
 IF (SELECT count(*) FROM public.companies WHERE parent_company_id=p_parent)>=100 THEN
  RAISE EXCEPTION 'Достигнат е лимитът от 100 подразделения за една основна фирма.'; END IF;
 INSERT INTO public.companies(id,parent_company_id,name,slug,service_city,service_latitude,service_longitude,service_radius_km,
  email,phone,address,legal_name,registration_id,currency,is_active,document_checks_required,accepts_driver_applications,
  base_fare,price_per_km,price_per_minute,min_fare,dispatch_radius_km)
 VALUES(p_id,p_parent,label,'division-'||p_id::text,city,lat,lng,radius,parent.email,parent.phone,parent.address,
  parent.legal_name,parent.registration_id,'EUR',false,true,false,0,0,0,0,5) RETURNING * INTO child;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,new_value)
 VALUES(child.id,auth.uid(),'company',child.id,'company_division_created',jsonb_build_object('parent_company_id',p_parent,'service_city',city));
 RETURN to_jsonb(child);
END $f$;
CREATE FUNCTION public.create_company_division(p_id uuid,p_parent uuid,p_data jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$ SELECT private.create_company_division(p_id,p_parent,p_data); $f$;
REVOKE ALL ON FUNCTION private.create_company_division(uuid,uuid,jsonb),public.create_company_division(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.create_company_division(uuid,uuid,jsonb),public.create_company_division(uuid,uuid,jsonb) TO authenticated;

-- Pausing a configured city keeps its zone reserved: another city's cheaper
-- tariff must not silently replace it. Overlaps choose the closest zone centre.
CREATE FUNCTION private.division_covers_pickup(p_company uuid,p_lat double precision,p_lng double precision) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 WITH point AS (SELECT public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography geo),
 company AS (SELECT * FROM public.companies WHERE id=p_company),
 candidates AS (
  SELECT c.id,public.st_distance(public.st_setsrid(public.st_makepoint(c.service_longitude,c.service_latitude),4326)::public.geography,p.geo) distance
  FROM public.companies c CROSS JOIN point p CROSS JOIN company own
  WHERE c.parent_company_id=coalesce(own.parent_company_id,own.id) AND c.setup_completed_at IS NOT NULL
   AND c.service_radius_km IS NOT NULL AND public.st_dwithin(
    public.st_setsrid(public.st_makepoint(c.service_longitude,c.service_latitude),4326)::public.geography,p.geo,30000)
   AND public.st_dwithin(
    public.st_setsrid(public.st_makepoint(c.service_longitude,c.service_latitude),4326)::public.geography,p.geo,c.service_radius_km::double precision*1000)
 ), chosen AS (SELECT id FROM candidates ORDER BY distance,id LIMIT 1)
 SELECT coalesce(private.in_bulgaria(p_lat,p_lng) AND EXISTS(SELECT 1 FROM company c WHERE
  (c.parent_company_id IS NULL AND NOT EXISTS(SELECT 1 FROM chosen)
    AND (c.service_radius_km IS NULL OR EXISTS(SELECT 1 FROM point p WHERE public.st_dwithin(
      public.st_setsrid(public.st_makepoint(c.service_longitude,c.service_latitude),4326)::public.geography,p.geo,c.service_radius_km::double precision*1000))))
  OR (c.parent_company_id IS NOT NULL AND c.id=(SELECT id FROM chosen))),false);
$f$;
REVOKE ALL ON FUNCTION private.division_covers_pickup(uuid,double precision,double precision) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.division_covers_pickup(uuid,double precision,double precision) TO service_role;

CREATE FUNCTION private.company_tariff(p_company public.companies,p_at timestamptz) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT jsonb_build_object(
  'base_fare',CASE WHEN n THEN coalesce((p_company).night_base_fare,(p_company).base_fare) ELSE (p_company).base_fare END,
  'price_per_km',CASE WHEN n THEN coalesce((p_company).night_price_per_km,(p_company).price_per_km) ELSE (p_company).price_per_km END,
  'price_per_minute',CASE WHEN n THEN coalesce((p_company).night_price_per_minute,(p_company).price_per_minute) ELSE (p_company).price_per_minute END,
  'min_fare',CASE WHEN n THEN coalesce((p_company).night_min_fare,(p_company).min_fare) ELSE (p_company).min_fare END,
  'tariff_period',CASE WHEN n THEN 'night' ELSE 'day' END,'priced_at',p_at)
 FROM (SELECT extract(hour FROM p_at AT TIME ZONE 'Europe/Sofia')<6 OR extract(hour FROM p_at AT TIME ZONE 'Europe/Sofia')>=22 AS n) clock;
$f$;
REVOKE ALL ON FUNCTION private.company_tariff(public.companies,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.company_tariff(public.companies,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.marketplace_quote_types(p_lat double precision,p_lng double precision) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT coalesce(jsonb_agg(to_jsonb(t)||private.company_tariff(c,statement_timestamp())||
  jsonb_build_object('company_name',c.name,'type_name',vt.name,'capacity',vt.capacity)
  ORDER BY t.service_class,t.company_id,t.id),'[]'::jsonb)
 FROM private.marketplace_types(p_lat,p_lng) t JOIN public.companies c ON c.id=t.company_id
 JOIN public.vehicle_types vt ON vt.id=t.id AND vt.company_id=t.company_id;
$f$;

CREATE FUNCTION public.company_route_pricing(p_company uuid,p_lat double precision,p_lng double precision) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.company_tariff(c,statement_timestamp())||jsonb_build_object('id',c.id,'currency',c.currency,
 'types',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM
  (SELECT id,multiplier FROM public.vehicle_types WHERE company_id=c.id AND is_active ORDER BY id LIMIT 33) v),'[]'::jsonb))
 FROM public.companies c WHERE c.id=p_company AND c.is_active AND c.currency='EUR' AND private.division_covers_pickup(c.id,p_lat,p_lng);
$f$;
REVOKE ALL ON FUNCTION public.company_route_pricing(uuid,double precision,double precision) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.company_route_pricing(uuid,double precision,double precision) TO service_role;

-- Additional function changes and the final COMMIT follow below.
CREATE OR REPLACE FUNCTION private.eligible_drivers(p_company uuid, p_type uuid, p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(driver_id uuid, user_id uuid)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT d.id, d.user_id
  FROM public.drivers d
  JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
  JOIN public.companies c ON c.id=d.company_id AND c.is_active
  JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
  JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
  JOIN public.driver_locations l ON l.driver_id=d.id AND l.company_id=d.company_id
  WHERE d.company_id=p_company AND v.vehicle_type_id=p_type
    AND (p_user IS NULL OR d.user_id=p_user) AND d.is_online AND d.is_verified AND private.driver_documents_ready(d.id)
    AND private.location_is_current(l.updated_at,l.position_at,l.speed,clock_timestamp())
    AND l.accuracy BETWEEN 0 AND 100
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND c.dispatch_radius_km > 0 AND private.division_covers_pickup(c.id,p_lat,p_lng)
    AND public.st_dwithin(l.geo,
      public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
      c.dispatch_radius_km::double precision*1000)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r
      WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$;

CREATE OR REPLACE FUNCTION private.marketplace_drivers(p_lat double precision, p_lng double precision, p_user uuid DEFAULT NULL::uuid)
 RETURNS TABLE(driver_id uuid, user_id uuid, company_id uuid, vehicle_type_id uuid, service_class text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT d.id,d.user_id,d.company_id,v.vehicle_type_id,vt.service_class
 FROM public.driver_locations l
 JOIN public.drivers d ON d.id=l.driver_id AND d.company_id=l.company_id
 JOIN public.profiles p ON p.id=d.user_id AND p.role='DRIVER' AND p.is_active
 JOIN public.companies c ON c.id=d.company_id AND c.is_active AND c.currency='EUR'
 JOIN public.vehicles v ON v.id=d.vehicle_id AND v.company_id=d.company_id AND v.is_active
 JOIN public.vehicle_types vt ON vt.id=v.vehicle_type_id AND vt.company_id=d.company_id AND vt.is_active
 WHERE private.in_bulgaria(p_lat,p_lng) AND (p_user IS NULL OR d.user_id=p_user)
 AND d.is_online AND d.is_verified AND private.driver_documents_ready(d.id)
 AND private.location_is_current(l.updated_at,l.position_at,l.speed,clock_timestamp()) AND l.accuracy BETWEEN 0 AND 100
 AND c.dispatch_radius_km>0 AND private.division_covers_pickup(c.id,p_lat,p_lng)
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
  coalesce((SELECT max(dispatch_radius_km)::double precision*1000 FROM public.companies WHERE is_active),0))
 AND public.st_dwithin(l.geo,public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,c.dispatch_radius_km::double precision*1000)
 AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$;

CREATE OR REPLACE FUNCTION private.create_partner_invitation(p_id uuid, p_kind text, p_email text, p_company uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u uuid:=auth.uid(); e text:=lower(btrim(p_email)); existing public.partner_invitations; actor public.profiles;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=u;
 IF NOT FOUND OR NOT actor.is_active OR p_id IS NULL OR p_kind NOT IN ('company','driver') OR p_kind IS NULL THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF (p_kind='company' AND NOT (public.is_super_admin() OR (private.staff_mfa_allowed() AND actor.role='COMPANY_ADMIN' AND EXISTS(SELECT 1 FROM public.companies child WHERE child.id=p_company AND child.parent_company_id=actor.company_id)))) OR
 (p_kind='driver' AND (p_company IS NULL OR NOT (public.is_super_admin() OR public.is_company_admin(p_company)))) THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF e IS NULL OR length(e)>254 OR e !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Въведете валиден имейл.'; END IF;
 IF p_company IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.companies WHERE id=p_company AND setup_completed_at IS NOT NULL AND (p_kind='company' OR is_active)) THEN
  RAISE EXCEPTION 'Първо завършете настройката на активната фирма.'; END IF;
 -- A stable request ID makes retrying after a lost response safe.
 PERFORM pg_advisory_xact_lock(hashtextextended('partner-invite:'||e,0));
 SELECT * INTO existing FROM public.partner_invitations WHERE id=p_id;
 IF FOUND THEN
  IF (existing.created_by,existing.kind,existing.email,existing.company_id) IS DISTINCT FROM (u,p_kind,e,p_company) THEN
   RAISE EXCEPTION 'Поканата не отговаря на тази заявка.' USING ERRCODE='42501'; END IF;
  RETURN existing.id;
 END IF;
 UPDATE public.partner_invitations SET status='revoked' WHERE email=e AND status='pending' AND expires_at<=clock_timestamp();
 SELECT * INTO existing FROM public.partner_invitations WHERE email=e AND status='pending';
 IF FOUND THEN
  IF (existing.kind,existing.company_id) IS DISTINCT FROM (p_kind,p_company) THEN
   RAISE EXCEPTION 'За този имейл вече има друга активна покана.'; END IF;
  RETURN existing.id;
 END IF;
 IF EXISTS(SELECT 1 FROM auth.users a JOIN public.profiles p ON p.id=a.id
 WHERE lower(a.email)=e AND (p.role='SUPER_ADMIN' OR (p.role='DRIVER' AND NOT (p_kind='driver' AND p.company_id IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM public.driver_applications a WHERE a.user_id=p.id AND a.status='approved')))
  OR (p.role='COMPANY_ADMIN' AND p.company_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'Този имейл вече има партньорски достъп. Не е създадена нова покана.'; END IF;
 IF (SELECT count(*) FROM public.partner_invitations WHERE created_by=u AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
  RAISE EXCEPTION 'Достигнат е лимитът за покани. Опитайте по-късно.'; END IF;
 INSERT INTO public.partner_invitations(id,kind,email,company_id,created_by) VALUES(p_id,p_kind,e,p_company,u);
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(p_company,u,'partner_invitation',p_id,'invitation_created');
 RETURN p_id;
END $function$;

CREATE OR REPLACE FUNCTION private.revoke_partner_invitation(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE i public.partner_invitations;
BEGIN
 SELECT * INTO i FROM public.partner_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT (public.is_super_admin() OR (i.kind='driver' AND public.is_company_admin(i.company_id)) OR (i.kind='company' AND private.staff_mfa_allowed() AND EXISTS(SELECT 1 FROM public.companies child JOIN public.profiles actor ON actor.company_id=child.parent_company_id WHERE child.id=i.company_id AND actor.id=auth.uid() AND actor.role='COMPANY_ADMIN' AND actor.is_active))) THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF i.status='accepted' THEN RAISE EXCEPTION 'Поканата е приета. Управлявайте достъпа от профила на партньора.'; END IF;
 UPDATE public.partner_invitations SET status='revoked' WHERE id=p_id;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(i.company_id,auth.uid(),'partner_invitation',p_id,'invitation_revoked');
END $function$;

CREATE OR REPLACE FUNCTION private.claim_partner_invitation_email(p_id uuid, p_actor uuid, p_resend boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE i public.partner_invitations; actor public.profiles; lease uuid:=gen_random_uuid(); attempt integer;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor;
 SELECT * INTO i FROM public.partner_invitations WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR actor.id IS NULL OR NOT actor.is_active OR NOT (actor.role='SUPER_ADMIN' OR (actor.role='COMPANY_ADMIN' AND ((i.kind='driver' AND actor.company_id=i.company_id) OR EXISTS(SELECT 1 FROM public.companies child WHERE child.id=i.company_id AND child.parent_company_id=actor.company_id)))) THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF i.status<>'pending' OR i.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('claimed',false,'status',i.status); END IF;
 IF i.email_lease_until>clock_timestamp() THEN RETURN jsonb_build_object('claimed',false,'status',i.email_status); END IF;
 IF i.email_status='sent' AND NOT p_resend THEN RETURN jsonb_build_object('claimed',false,'status','sent'); END IF;
 IF i.email_status='sent' AND i.email_sent_at>clock_timestamp()-interval '1 minute' THEN RAISE EXCEPTION 'Изчакайте минута преди повторно изпращане.'; END IF;
 IF i.email_attempt>=5 THEN RAISE EXCEPTION 'Използвайте личния линк. Достигнат е лимитът за изпращане.'; END IF;
 -- An ambiguous network result reuses the last key for up to Resend's 24h retention.
 attempt:=CASE WHEN i.email_status IN ('failed','sending') AND i.email_attempt_at>clock_timestamp()-interval '23 hours' THEN greatest(i.email_attempt,1) ELSE i.email_attempt+1 END;
 UPDATE public.partner_invitations SET email_status='sending',email_lease=lease,email_lease_until=clock_timestamp()+interval '90 seconds',
 email_attempt=attempt,email_attempt_at=CASE WHEN attempt=i.email_attempt THEN i.email_attempt_at ELSE clock_timestamp() END,email_error=NULL WHERE id=p_id;
 RETURN jsonb_build_object('claimed',true,'lease',lease,'attempt',attempt,'email',i.email,'kind',i.kind,'company_name',(SELECT name FROM public.companies WHERE id=i.company_id));
END $function$;

CREATE OR REPLACE FUNCTION private.notification_recipient_valid(p_user uuid, p_audience text, p_company uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_user AND p.is_active AND (
 (p_audience='customer' AND p.role='CUSTOMER') OR
 (p_audience='company' AND p.role='COMPANY_ADMIN' AND (p.company_id=p_company OR EXISTS(SELECT 1 FROM public.companies child WHERE child.id=p_company AND child.parent_company_id=p.company_id)) AND EXISTS(SELECT 1 FROM public.companies c WHERE c.id=p_company AND c.is_active)) OR
 (p_audience='driver' AND p.role='DRIVER' AND p.company_id=p_company AND EXISTS(SELECT 1 FROM public.drivers d WHERE d.user_id=p.id AND d.company_id=p_company))));
$function$;

CREATE OR REPLACE FUNCTION private.notify_company(p_company uuid, p_kind text, p_key text, p_title text, p_message text, p_data jsonb DEFAULT '{}'::jsonb, p_request uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE recipient uuid; division_name text;
BEGIN
 SELECT CASE WHEN parent_company_id IS NOT NULL THEN name END INTO division_name FROM public.companies WHERE id=p_company;
 FOR recipient IN SELECT id FROM public.profiles WHERE role='COMPANY_ADMIN' AND (company_id=p_company OR company_id=(SELECT parent_company_id FROM public.companies WHERE id=p_company)) AND is_active LOOP
  PERFORM private.add_notification(recipient,p_company,'company',p_kind,p_key,CASE WHEN division_name IS NULL THEN p_title ELSE p_title||' · '||division_name END,p_message,p_data||jsonb_build_object('company_id',p_company),p_request);
 END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION private.accounting_report_v3(p_from date, p_until date, p_company_id uuid, p_driver_id uuid, p_page integer, p_export boolean, p_summary boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE result jsonb; cid uuid:=p_company_id; take integer:=CASE WHEN p_summary THEN 0 WHEN p_export THEN 10000 ELSE 25 END;
 start_at timestamptz:=p_from::timestamp AT TIME ZONE 'Europe/Sofia';
 end_at timestamptz:=p_until::timestamp AT TIME ZONE 'Europe/Sofia';
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN
  RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501';
 END IF;
 IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until) OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 OR p_export IS NULL THEN
  RAISE EXCEPTION 'Invalid report period';
 END IF;
 IF p_driver_id IS NOT NULL THEN
  SELECT d.company_id INTO cid FROM public.drivers d WHERE d.id=p_driver_id
   AND (public.is_driver(d.id) OR public.is_company_admin(d.company_id) OR public.is_super_admin());
  IF NOT FOUND OR (p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM cid) THEN
   RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501';
  END IF;
 ELSIF cid IS NULL OR NOT(public.is_company_admin(cid) OR public.is_super_admin()) THEN
  RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501';
 END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name
  FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id
  LEFT JOIN public.taxi_requests request ON request.id=o.request_id
  WHERE o.company_id=cid AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND (o.driver_id IS NOT NULL OR request.fare_breakdown->'marketplace' IS NULL)
   AND o.occurred_at>=start_at AND o.occurred_at<end_at
 ), postings AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,
   original.kind reference_kind,original.recorded_at reference_recorded_at,
   coalesce(original.kind,e.kind) effective_kind,
   coalesce(original.payment_method,e.payment_method) effective_method,
   CASE WHEN e.kind='reversal' THEN -e.amount WHEN e.kind='confirmation' THEN 0 ELSE e.amount END signed_amount,
   CASE WHEN e.kind='confirmation' THEN e.amount WHEN e.kind='reversal' AND EXISTS(
    SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=e.reference_id AND c.kind='confirmation'
   ) THEN -e.amount ELSE 0 END verified_amount
  FROM public.driver_money_entries e
  LEFT JOIN public.driver_money_entries original ON original.id=e.reference_id
  LEFT JOIN public.profiles p ON p.id=e.driver_user_id
  WHERE e.company_id=cid AND (p_driver_id IS NULL OR e.driver_id=p_driver_id) AND e.recorded_at<end_at
 ), movements AS MATERIALIZED (
  SELECT p.*,CASE WHEN effective_kind='income' THEN signed_amount ELSE -signed_amount END balance_delta FROM postings p
 ), period_money AS MATERIALIZED (
  SELECT m.* FROM movements m WHERE recorded_at>=start_at
 ), shown_outcomes AS MATERIALIZED (
  SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT take OFFSET p_page*take
 ), reconciliation AS MATERIALIZED (
  -- Current reconciliation is explicitly separate from historical postings.
  SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
   coalesce(e.company_confirmed,false) company_confirmed,e.amount-o.booked_amount difference,
   e.method payment_method, greatest(0,o.booked_amount-coalesce(e.amount,0)) outstanding,
   receipt.choice checkout_choice,receipt.note payment_note
  FROM shown_outcomes o LEFT JOIN public.ride_payment_receipts receipt ON receipt.request_id=o.request_id
  LEFT JOIN LATERAL (
   SELECT sum(m.amount) amount,max(m.recorded_at) recorded_at,
    bool_and(EXISTS(SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation')) company_confirmed,
    CASE WHEN count(DISTINCT coalesce(m.payment_method,'unknown'))>1 THEN 'mixed' ELSE max(m.payment_method) END method
   FROM public.driver_money_entries m WHERE m.request_id=o.request_id AND m.kind='income'
    AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')
  ) e ON true WHERE o.outcome='completed'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts,
   count(*) FILTER(WHERE outcome='completed' AND (SELECT sum(m.amount) FROM public.driver_money_entries m WHERE m.request_id=outcomes.request_id AND m.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')) BETWEEN 0.01 AND booked_amount-0.01) partially_paid,
   count(*) FILTER(WHERE outcome='completed' AND NOT EXISTS(
    SELECT 1 FROM public.driver_money_entries m WHERE m.request_id=outcomes.request_id AND m.kind='income'
     AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal')
   )) unreported_completed FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(signed_amount) FILTER(WHERE effective_kind='income'),0) income,
   coalesce(sum(signed_amount) FILTER(WHERE effective_kind='expense'),0) expenses,
   coalesce(sum(signed_amount) FILTER(WHERE effective_kind='handover'),0) handed_over,
   coalesce(sum(verified_amount) FILTER(WHERE effective_kind='handover'),0) confirmed_handover,
   coalesce(sum(verified_amount) FILTER(WHERE effective_kind='income'),0) confirmed_income,
   coalesce(sum(CASE WHEN effective_kind='income' THEN signed_amount WHEN effective_kind='expense' THEN -signed_amount ELSE 0 END),0) net_income
  FROM period_money
 ), balances AS (
  SELECT coalesce(sum(balance_delta) FILTER(WHERE recorded_at<start_at),0) opening,
   coalesce(sum(balance_delta) FILTER(WHERE recorded_at>=start_at),0) movement,
   coalesce(sum(balance_delta),0) closing,
   coalesce(sum(signed_amount-verified_amount) FILTER(WHERE effective_kind='handover'),0) unconfirmed_handover,
   coalesce(sum(signed_amount-verified_amount) FILTER(WHERE effective_kind='income'),0) unconfirmed_income
  FROM movements
 ), payment_breakdown AS (
  SELECT
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='cash'),0) cash_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='card'),0) card_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method IS NULL),0) unknown_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method='cash'),0) cash_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method='card'),0) card_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense' AND effective_method IS NULL),0) unknown_expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover' AND effective_method='cash'),0) cash_handover,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover' AND effective_method IS NULL),0) unknown_handover,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash' AND recorded_at<start_at),0) cash_opening,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash' AND recorded_at>=start_at),0) cash_movement,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash'),0) cash_closing,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method IS NULL),0) unknown_closing
  FROM movements
 ), driver_trips AS (
  SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,
   count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked
  FROM outcomes GROUP BY driver_id
 ), driver_money AS (
  SELECT driver_id,max(driver_name) driver_name,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income'),0) income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='expense'),0) expenses,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover'),0) handed_over,
   coalesce(sum(verified_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income'),0) confirmed_income,
   coalesce(sum(verified_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='handover'),0) confirmed_handover,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='cash'),0) cash_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method='card'),0) card_income,
   coalesce(sum(signed_amount) FILTER(WHERE recorded_at>=start_at AND effective_kind='income' AND effective_method IS NULL),0) unknown_income,
   coalesce(sum(balance_delta) FILTER(WHERE effective_method='cash'),0) cash_closing,
   coalesce(sum(balance_delta),0) closing
  FROM movements GROUP BY driver_id
 ), driver_ids AS (
  SELECT driver_id FROM driver_trips UNION SELECT driver_id FROM driver_money
 ), drivers AS (
  SELECT ids.driver_id,coalesce(t.driver_name,m.driver_name,'') driver_name,
   coalesce(t.trips,0) trips,coalesce(t.cancelled,0) cancelled,coalesce(t.booked,0) booked,
   coalesce(m.cash_income,0) cash_income,coalesce(m.card_income,0) card_income,coalesce(m.unknown_income,0) unknown_income,coalesce(m.cash_closing,0) cash_closing,
   coalesce(m.income,0) income,coalesce(m.expenses,0) expenses,coalesce(m.handed_over,0) handed_over,
   coalesce(m.confirmed_income,0) confirmed_income,coalesce(m.confirmed_handover,0) confirmed_handover,coalesce(m.closing,0) closing
  FROM driver_ids ids LEFT JOIN driver_trips t ON t.driver_id IS NOT DISTINCT FROM ids.driver_id
   LEFT JOIN driver_money m ON m.driver_id IS NOT DISTINCT FROM ids.driver_id
 ) SELECT jsonb_build_object(
  'report_version',2,'period',jsonb_build_object('from',p_from,'until',p_until,'timezone','Europe/Sofia'),
  'scope',jsonb_build_object('company_id',cid,'driver_id',p_driver_id),'currency','EUR','generated_at',statement_timestamp(),
  'payment_breakdown',(SELECT to_jsonb(pb) FROM payment_breakdown pb),'totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),'balance',(SELECT to_jsonb(b) FROM balances b),
  'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM period_money),'driver_count',(SELECT count(*) FROM drivers),
  'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM reconciliation r),'[]'::jsonb),
  'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY occurred_at DESC,id) FROM (
   SELECT o.*,(SELECT to_jsonb(e) FROM public.ride_evidence e WHERE e.request_id=o.request_id) evidence FROM shown_outcomes o
  ) x),'[]'::jsonb),
  'entries',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY recorded_at DESC,id) FROM (
   SELECT m.*,
    EXISTS(SELECT 1 FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal') reversed,
    EXISTS(SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation') confirmed,
    (SELECT r.recorded_at FROM public.driver_money_entries r WHERE r.reference_id=m.id AND r.kind='reversal') reversed_at,
    (SELECT c.recorded_at FROM public.driver_money_entries c WHERE c.reference_id=m.id AND c.kind='confirmation') confirmed_at
   FROM period_money m ORDER BY recorded_at DESC,id LIMIT take OFFSET p_page*take
  ) x),'[]'::jsonb),
  'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY booked DESC,driver_id) FROM (
   SELECT * FROM drivers ORDER BY booked DESC,driver_id LIMIT CASE WHEN p_summary THEN 0 WHEN p_export THEN 10000 ELSE 50 END
  ) x),'[]'::jsonb)
 ) INTO result;
 IF p_export AND (greatest((result->>'outcome_count')::bigint,(result->>'entry_count')::bigint,(result->>'driver_count')::bigint)>10000) THEN
  RAISE EXCEPTION 'Export limit exceeded: narrow the period to at most 10000 records per collection' USING ERRCODE='54000';
 END IF;
 RETURN result;
END $function$;


REVOKE ALL ON FUNCTION private.accounting_report_v3(date,date,uuid,uuid,integer,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.accounting_report_v3(date,date,uuid,uuid,integer,boolean,boolean) TO authenticated;
CREATE OR REPLACE FUNCTION private.accounting_report_v2(p_from date,p_until date,p_company_id uuid,p_driver_id uuid,p_page integer,p_export boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$
 SELECT private.accounting_report_v3(p_from,p_until,p_company_id,p_driver_id,p_page,p_export,false);
$f$;

CREATE FUNCTION private.company_group_report(p_parent uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (public.is_company_admin(p_parent) OR public.is_super_admin()) OR NOT EXISTS(
  SELECT 1 FROM public.companies WHERE id=p_parent AND parent_company_id IS NULL) THEN
  RAISE EXCEPTION 'Общият отчет изисква достъп до основната фирма.' USING ERRCODE='42501'; END IF;
 IF p_from IS NULL OR p_until IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_until) OR p_until<=p_from OR p_until-p_from>366 THEN
  RAISE EXCEPTION 'Изберете валиден период до една година.'; END IF;
 WITH reports AS MATERIALIZED (
  SELECT c.id,c.name,c.service_city,c.parent_company_id,c.is_active,
   private.accounting_report_v3(p_from,p_until,c.id,NULL,0,false,true) report
  FROM public.companies c WHERE c.id=p_parent OR c.parent_company_id=p_parent
 ), rows AS MATERIALIZED (
  SELECT id,name,service_city,parent_company_id,is_active,
   jsonb_build_object('completed',(report->'totals'->>'completed')::bigint,
    'cancelled',(report->'totals'->>'cancelled')::bigint,
    'income',(report->'finances'->>'income')::numeric,
    'expenses',(report->'finances'->>'expenses')::numeric,
    'handed_over',(report->'finances'->>'handed_over')::numeric,
    'cash_income',(report->'payment_breakdown'->>'cash_income')::numeric,
    'card_income',(report->'payment_breakdown'->>'card_income')::numeric,
    'unknown_income',(report->'payment_breakdown'->>'unknown_income')::numeric,
    'cash_closing',(report->'payment_breakdown'->>'cash_closing')::numeric) summary
  FROM reports
 ) SELECT jsonb_build_object('report_version',1,'parent_company_id',p_parent,'currency','EUR',
  'period',jsonb_build_object('from',p_from,'until',p_until,'timezone','Europe/Sofia'),'generated_at',statement_timestamp(),
  'companies',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY parent_company_id NULLS FIRST,name,id) FROM rows r),'[]'::jsonb),
  'total',(SELECT jsonb_build_object('completed',sum((summary->>'completed')::bigint),'cancelled',sum((summary->>'cancelled')::bigint),
   'income',sum((summary->>'income')::numeric),'expenses',sum((summary->>'expenses')::numeric),'handed_over',sum((summary->>'handed_over')::numeric),
   'cash_income',sum((summary->>'cash_income')::numeric),'card_income',sum((summary->>'card_income')::numeric),
   'unknown_income',sum((summary->>'unknown_income')::numeric),'cash_closing',sum((summary->>'cash_closing')::numeric)) FROM rows)) INTO result;
 RETURN result;
END $f$;
CREATE FUNCTION public.company_group_report(p_parent uuid,p_from date,p_until date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $f$ SELECT private.company_group_report(p_parent,p_from,p_until); $f$;
REVOKE ALL ON FUNCTION private.company_group_report(uuid,date,date),public.company_group_report(uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.company_group_report(uuid,date,date),public.company_group_report(uuid,date,date) TO authenticated;

-- Parent owners can invite an administrator only to their own direct child.
ALTER POLICY invitation_admin_read ON public.partner_invitations USING(
 public.is_super_admin() OR (kind='driver' AND public.is_company_admin(company_id))
 OR (kind='company' AND private.staff_mfa_allowed() AND EXISTS(
  SELECT 1 FROM public.companies child JOIN public.profiles actor ON actor.company_id=child.parent_company_id
  WHERE child.id=partner_invitations.company_id AND actor.id=auth.uid() AND actor.role='COMPANY_ADMIN' AND actor.is_active)));

CREATE OR REPLACE FUNCTION private.audit_company_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE before_value jsonb; after_value jsonb; fields text[]:=ARRAY[
 'name','service_city','base_fare','min_fare','price_per_km','price_per_minute','currency','dispatch_radius_km',
 'night_base_fare','night_min_fare','night_price_per_km','night_price_per_minute',
 'service_latitude','service_longitude','service_radius_km','is_active','accepts_driver_applications','document_checks_required'];
BEGIN
 SELECT jsonb_object_agg(key,value) INTO before_value FROM jsonb_each(to_jsonb(OLD)) WHERE key=ANY(fields);
 SELECT jsonb_object_agg(key,value) INTO after_value FROM jsonb_each(to_jsonb(NEW)) WHERE key=ANY(fields);
 IF before_value IS DISTINCT FROM after_value THEN
  INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(NEW.id,auth.uid(),'company',NEW.id,'company_rules_changed',before_value,after_value);
 END IF;
 RETURN NEW;
END $f$;
DROP TRIGGER audit_company_rules ON public.companies;
CREATE TRIGGER audit_company_rules AFTER UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.audit_company_rules();

CREATE OR REPLACE FUNCTION public.open_notification(p_id uuid) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE n public.notifications; r public.taxi_requests; path text;
BEGIN
 SELECT * INTO n FROM public.notifications WHERE id=p_id AND user_id=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Известието не е достъпно за този профил.' USING ERRCODE='42501'; END IF;
 IF n.audience='company' THEN
  path:=CASE WHEN n.data->>'request_id' IS NOT NULL THEN '/admin/orders?request='||(n.data->>'request_id')
   WHEN n.data->>'application_id' IS NOT NULL THEN '/admin/drivers?application='||(n.data->>'application_id')
   WHEN n.data->>'driver_id' IS NOT NULL THEN '/admin/drivers?driver='||(n.data->>'driver_id') ELSE '/admin/drivers' END;
 ELSIF n.audience='driver' THEN
  path:=CASE WHEN n.data->>'request_id' IS NOT NULL THEN '/driver/requests' ELSE '/driver/profile' END;
 ELSIF n.data->>'application_id' IS NOT NULL THEN path:='/driver-join?company='||n.company_id;
 ELSIF n.data->>'request_id' IS NOT NULL THEN
  SELECT * INTO r FROM public.taxi_requests WHERE id=(n.data->>'request_id')::uuid AND customer_id=auth.uid();
  path:=CASE WHEN NOT FOUND THEN '/customer/orders' WHEN r.status='completed' AND r.driver_id IS NOT NULL
   THEN '/customer/orders?rate='||r.id WHEN r.status='cancelled' THEN '/customer/home?retry='||r.id ELSE '/customer/home' END;
 ELSE path:='/customer/home'; END IF;
 IF n.audience='company' AND EXISTS(SELECT 1 FROM public.companies WHERE id=n.company_id AND parent_company_id IS NOT NULL) THEN
  path:=path||CASE WHEN strpos(path,'?')>0 THEN '&' ELSE '?' END||'company='||n.company_id::text;
 END IF;
 UPDATE public.notifications SET is_read=true WHERE id=n.id;
 RETURN path;
END $f$;

NOTIFY pgrst,'reload schema';
COMMIT;
