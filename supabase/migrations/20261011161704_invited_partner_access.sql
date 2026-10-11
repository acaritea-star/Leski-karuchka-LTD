-- Named invitations grant membership only after a confirmed server-side email match.
-- Existing companies keep their current behaviour; new companies start as drafts.
ALTER TABLE public.companies ADD COLUMN setup_completed_at timestamptz;
ALTER TABLE public.companies ADD COLUMN service_city text;
UPDATE public.companies SET setup_completed_at=created_at;

CREATE TABLE public.partner_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('company','driver')),
 email text NOT NULL CHECK (email=lower(btrim(email)) AND length(email)<=254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
 created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '14 days',
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
 accepted_by uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
 accepted_at timestamptz,
 email_status text NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sending','sent','failed')),
 email_attempt integer NOT NULL DEFAULT 0,
 email_lease uuid,
 email_lease_until timestamptz,
 email_attempt_at timestamptz,
 email_sent_at timestamptz,
 email_message_id text,
 email_error text,
 CHECK (kind<>'driver' OR company_id IS NOT NULL),
 CHECK ((status='accepted')=(accepted_by IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX partner_invitations_open_email ON public.partner_invitations(email) WHERE status='pending';
CREATE INDEX partner_invitations_company_created ON public.partner_invitations(company_id,created_at DESC);
CREATE INDEX partner_invitations_accepted_user ON public.partner_invitations(accepted_by);
CREATE INDEX partner_invitations_creator_created ON public.partner_invitations(created_by,created_at DESC);
CREATE INDEX partner_invitations_email_created ON public.partner_invitations(email,created_at DESC);
ALTER TABLE public.partner_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_invitations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.partner_invitations TO authenticated;
GRANT ALL ON public.partner_invitations TO service_role;
CREATE POLICY invitation_admin_read ON public.partner_invitations FOR SELECT TO authenticated
 USING(public.is_super_admin() OR (kind='driver' AND public.is_company_admin(company_id)));

-- Include the user's own invitation data in their download without exposing other recipients.
CREATE FUNCTION private.my_partner_invitation_data() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); e text;
BEGIN
 IF u IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT lower(email) INTO e FROM auth.users WHERE id=u AND email_confirmed_at IS NOT NULL;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
  SELECT id,kind,email,company_id,status,created_at,expires_at,accepted_at,email_status,email_sent_at
  FROM public.partner_invitations WHERE accepted_by=u OR email=e ORDER BY created_at DESC LIMIT 1000
 )x),'[]'::jsonb);
END $fn$;
CREATE FUNCTION public.my_partner_invitation_data() RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.my_partner_invitation_data(); $fn$;
REVOKE ALL ON FUNCTION private.my_partner_invitation_data(),public.my_partner_invitation_data() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.my_partner_invitation_data(),public.my_partner_invitation_data() TO authenticated;

CREATE FUNCTION private.create_partner_invitation(p_id uuid,p_kind text,p_email text,p_company uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE u uuid:=auth.uid(); e text:=lower(btrim(p_email)); existing public.partner_invitations; actor public.profiles;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=u;
 IF NOT FOUND OR NOT actor.is_active OR p_id IS NULL OR p_kind NOT IN ('company','driver') OR p_kind IS NULL THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF (p_kind='company' AND NOT public.is_super_admin()) OR
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
 WHERE lower(a.email)=e AND (p.role IN ('SUPER_ADMIN','DRIVER') OR (p.role='COMPANY_ADMIN' AND p.company_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'Този имейл вече има партньорски достъп. Не е създадена нова покана.'; END IF;
 IF (SELECT count(*) FROM public.partner_invitations WHERE created_by=u AND created_at>clock_timestamp()-interval '1 hour')>=30 THEN
  RAISE EXCEPTION 'Достигнат е лимитът за покани. Опитайте по-късно.'; END IF;
 INSERT INTO public.partner_invitations(id,kind,email,company_id,created_by) VALUES(p_id,p_kind,e,p_company,u);
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(p_company,u,'partner_invitation',p_id,'invitation_created');
 RETURN p_id;
END $fn$;
CREATE FUNCTION public.create_partner_invitation(p_id uuid,p_kind text,p_email text,p_company uuid DEFAULT NULL) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.create_partner_invitation(p_id,p_kind,p_email,p_company); $fn$;

CREATE FUNCTION private.revoke_partner_invitation(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE i public.partner_invitations;
BEGIN
 SELECT * INTO i FROM public.partner_invitations WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT (public.is_super_admin() OR (i.kind='driver' AND public.is_company_admin(i.company_id))) THEN
  RAISE EXCEPTION 'Нямате права за тази покана.' USING ERRCODE='42501'; END IF;
 IF i.status='accepted' THEN RAISE EXCEPTION 'Поканата е приета. Управлявайте достъпа от профила на партньора.'; END IF;
 UPDATE public.partner_invitations SET status='revoked' WHERE id=p_id;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(i.company_id,auth.uid(),'partner_invitation',p_id,'invitation_revoked');
END $fn$;
CREATE FUNCTION public.revoke_partner_invitation(p_id uuid) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.revoke_partner_invitation(p_id); $fn$;

CREATE FUNCTION private.resolve_partner_access(p_kind text,p_invitation uuid) RETURNS jsonb
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
CREATE FUNCTION public.resolve_partner_access(p_kind text DEFAULT 'any',p_invitation uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.resolve_partner_access(p_kind,p_invitation); $fn$;

CREATE FUNCTION private.complete_company_setup(p_company uuid,p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.companies; base numeric; km numeric; minute numeric; minimum numeric; radius numeric; expiry date;
BEGIN
 IF NOT (public.is_super_admin() OR public.is_company_admin(p_company)) THEN RAISE EXCEPTION 'Нямате достъп до тази фирма.' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM public.companies WHERE id=p_company FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Фирмата не е намерена.'; END IF;
 -- A lost successful response can be retried without overwriting a completed setup.
 IF c.setup_completed_at IS NOT NULL THEN RETURN to_jsonb(c); END IF;
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR
 length(btrim(coalesce(p_data->>'name',''))) NOT BETWEEN 2 AND 120 OR
 length(btrim(coalesce(p_data->>'legal_name',''))) NOT BETWEEN 2 AND 180 OR
 coalesce(p_data->>'registration_id','') !~ '^([0-9]{9}|[0-9]{13})$' OR
 length(btrim(coalesce(p_data->>'phone',''))) NOT BETWEEN 6 AND 30 OR
 length(btrim(coalesce(p_data->>'address',''))) NOT BETWEEN 5 AND 300 OR
 length(btrim(coalesce(p_data->>'service_city',''))) NOT BETWEEN 2 AND 100 OR
 length(btrim(coalesce(p_data->>'permit_number',''))) NOT BETWEEN 1 AND 120 THEN
  RAISE EXCEPTION 'Попълнете фирма, ЕИК, телефон, адрес, основен град и разрешение.'; END IF;
 BEGIN
  base:=(p_data->>'base_fare')::numeric; km:=(p_data->>'price_per_km')::numeric;
  minute:=(p_data->>'price_per_minute')::numeric; minimum:=(p_data->>'min_fare')::numeric;
  radius:=(p_data->>'dispatch_radius_km')::numeric; expiry:=(p_data->>'permit_expires_on')::date;
 EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow THEN RAISE EXCEPTION 'Проверете тарифите и датата на разрешението.'; END;
 IF base IS NULL OR km IS NULL OR minute IS NULL OR minimum IS NULL OR radius IS NULL OR expiry IS NULL OR
 base NOT BETWEEN 0 AND 10000 OR km NOT BETWEEN 0.01 AND 1000 OR minute NOT BETWEEN 0 AND 1000 OR minimum NOT BETWEEN 0 AND 10000 OR
 radius NOT BETWEEN 0.5 AND 30 OR expiry<(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date OR
 base<>round(base,2) OR km<>round(km,2) OR minute<>round(minute,2) OR minimum<>round(minimum,2) THEN
  RAISE EXCEPTION 'Нужни са валидни цени до евроцент, положителна цена на км, радиус 0.5–30 км и неизтекло разрешение.'; END IF;
 UPDATE public.companies SET name=btrim(p_data->>'name'),legal_name=btrim(p_data->>'legal_name'),registration_id=p_data->>'registration_id',
 phone=btrim(p_data->>'phone'),address=btrim(p_data->>'address'),service_city=btrim(p_data->>'service_city'),
 permit_number=btrim(p_data->>'permit_number'),permit_expires_on=expiry,legal_verified_at=NULL,legal_verified_by=NULL,
 base_fare=base,price_per_km=km,price_per_minute=minute,min_fare=minimum,dispatch_radius_km=radius,currency='EUR',
 setup_completed_at=clock_timestamp(),is_active=true,document_checks_required=true,updated_at=clock_timestamp()
 WHERE id=p_company RETURNING * INTO c;
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action) VALUES(c.id,auth.uid(),'company',c.id,'company_setup_completed');
 RETURN to_jsonb(c);
END $fn$;
CREATE FUNCTION public.complete_company_setup(p_company uuid,p_data jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.complete_company_setup(p_company,p_data); $fn$;

-- Prevent a direct company UPDATE from bypassing the setup RPC.
CREATE FUNCTION private.guard_company_setup() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 IF current_user NOT IN ('postgres','service_role','supabase_admin') THEN
  IF NEW.setup_completed_at IS DISTINCT FROM OLD.setup_completed_at OR (OLD.setup_completed_at IS NULL AND NEW.is_active AND NOT OLD.is_active) THEN
   RAISE EXCEPTION 'Завършете фирмената настройка през приложението.' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.guard_company_setup() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_company_setup BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.guard_company_setup();

-- Persistent delivery lease and stable Resend idempotency key. Only service_role can claim/send.
CREATE FUNCTION private.claim_partner_invitation_email(p_id uuid,p_actor uuid,p_resend boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE i public.partner_invitations; actor public.profiles; lease uuid:=gen_random_uuid(); attempt integer;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor;
 SELECT * INTO i FROM public.partner_invitations WHERE id=p_id FOR UPDATE;
 IF i.id IS NULL OR NOT actor.is_active OR NOT (actor.role='SUPER_ADMIN' OR (i.kind='driver' AND actor.role='COMPANY_ADMIN' AND actor.company_id=i.company_id)) THEN
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
END $fn$;
CREATE FUNCTION public.claim_partner_invitation_email(p_id uuid,p_actor uuid,p_resend boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.claim_partner_invitation_email(p_id,p_actor,p_resend); $fn$;
CREATE FUNCTION private.finish_partner_invitation_email(p_id uuid,p_lease uuid,p_message text,p_error text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 UPDATE public.partner_invitations SET email_status=CASE WHEN p_message IS NOT NULL THEN 'sent' ELSE 'failed' END,
 email_message_id=p_message,email_sent_at=CASE WHEN p_message IS NOT NULL THEN clock_timestamp() ELSE email_sent_at END,
 email_error=left(p_error,300),email_lease_until=CASE WHEN p_message IS NULL THEN clock_timestamp()+interval '1 minute' ELSE NULL END
 WHERE id=p_id AND email_lease=p_lease AND email_status='sending';
 RETURN FOUND;
END $fn$;
CREATE FUNCTION public.finish_partner_invitation_email(p_id uuid,p_lease uuid,p_message text DEFAULT NULL,p_error text DEFAULT NULL) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.finish_partner_invitation_email(p_id,p_lease,p_message,p_error); $fn$;

REVOKE ALL ON FUNCTION private.create_partner_invitation(uuid,text,text,uuid),public.create_partner_invitation(uuid,text,text,uuid),
 private.revoke_partner_invitation(uuid),public.revoke_partner_invitation(uuid),private.resolve_partner_access(text,uuid),public.resolve_partner_access(text,uuid),
 private.complete_company_setup(uuid,jsonb),public.complete_company_setup(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.create_partner_invitation(uuid,text,text,uuid),public.create_partner_invitation(uuid,text,text,uuid),
 private.revoke_partner_invitation(uuid),public.revoke_partner_invitation(uuid),private.resolve_partner_access(text,uuid),public.resolve_partner_access(text,uuid),
 private.complete_company_setup(uuid,jsonb),public.complete_company_setup(uuid,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION private.claim_partner_invitation_email(uuid,uuid,boolean),public.claim_partner_invitation_email(uuid,uuid,boolean),
 private.finish_partner_invitation_email(uuid,uuid,text,text),public.finish_partner_invitation_email(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.claim_partner_invitation_email(uuid,uuid,boolean),public.claim_partner_invitation_email(uuid,uuid,boolean),
 private.finish_partner_invitation_email(uuid,uuid,text,text),public.finish_partner_invitation_email(uuid,uuid,text,text) TO service_role;

-- Restrict new applications to a named accepted invitation. Existing candidates are grandfathered.
CREATE FUNCTION private.guard_invited_driver_application() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') AND auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.driver_applications WHERE user_id=NEW.user_id AND company_id=NEW.company_id) THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.partner_invitations WHERE kind='driver' AND company_id=NEW.company_id AND status='accepted' AND accepted_by=NEW.user_id) THEN
  RAISE EXCEPTION 'За подготовката е необходима лична покана от фирмата.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.guard_invited_driver_application() FROM PUBLIC,anon,authenticated;
-- INSERT only: updates/finishing historical candidacies still work. ON CONFLICT inserts also pass this guard.
CREATE TRIGGER guard_invited_driver_application BEFORE INSERT ON public.driver_applications FOR EACH ROW EXECUTE FUNCTION private.guard_invited_driver_application();
