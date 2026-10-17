-- Open candidacy is explicit per firm. It never assigns a role or skips review.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Match the existing editor's non-negative, finite prices at the database too.
-- Keep zero/flat legacy tariffs valid; do not invent or rewrite anyone's rates.
ALTER TABLE public.companies ADD CONSTRAINT companies_valid_tariffs CHECK (
 base_fare>=0 AND base_fare<'Infinity'::numeric AND min_fare>=0 AND min_fare<'Infinity'::numeric
 AND price_per_km>=0 AND price_per_km<'Infinity'::numeric
 AND price_per_minute>=0 AND price_per_minute<'Infinity'::numeric
 AND dispatch_radius_km>0 AND dispatch_radius_km<'Infinity'::numeric);
ALTER TABLE public.companies ADD COLUMN accepts_driver_applications boolean NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD CONSTRAINT open_applications_require_documents
 CHECK (NOT accepts_driver_applications OR document_checks_required);

CREATE FUNCTION private.open_driver_access(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE p public.profiles; c public.companies; a public.driver_applications;
BEGIN
 SELECT * INTO p FROM public.profiles WHERE id=auth.uid() FOR UPDATE;
 IF auth.uid() IS NULL OR NOT FOUND OR NOT p.is_active OR p.role<>'CUSTOMER' OR
  NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p.id AND email_confirmed_at IS NOT NULL AND nullif(btrim(email),'') IS NOT NULL) THEN
  RAISE EXCEPTION 'Кандидатстването изисква активен клиентски профил с потвърден имейл.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.companies WHERE id=p_company AND accepts_driver_applications
  AND is_active AND setup_completed_at IS NOT NULL AND document_checks_required AND price_per_km>0 AND currency='EUR' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Фирмата в момента не приема отворени кандидатури.' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM public.driver_applications WHERE user_id=p.id;
 IF FOUND AND (a.status='approved' OR (a.status='pending' AND a.company_id<>c.id)) THEN
  RAISE EXCEPTION 'Вече имаш кандидатура към друга фирма или одобрен достъп. Продължи от текущата кандидатура.' USING ERRCODE='42501';
 END IF;
 -- Read/selection only. The existing onboarding RPC creates the application.
 RETURN jsonb_build_object('status','preparation','destination','/driver/access','role','CUSTOMER',
  'company_id',c.id,'company_name',c.name,'application_id',CASE WHEN a.company_id=c.id THEN a.id ELSE NULL END);
END $fn$;
CREATE FUNCTION public.open_driver_access(p_company uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$ SELECT private.open_driver_access(p_company); $fn$;
REVOKE ALL ON FUNCTION private.open_driver_access(uuid),public.open_driver_access(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.open_driver_access(uuid),public.open_driver_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.guard_invited_driver_application() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $fn$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') AND auth.uid() IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.driver_applications WHERE user_id=NEW.user_id AND company_id=NEW.company_id) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.partner_invitations WHERE kind='driver' AND company_id=NEW.company_id AND status='accepted' AND accepted_by=NEW.user_id) THEN RETURN NEW; END IF;
 IF NEW.user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
  WHERE p.id=NEW.user_id AND p.is_active AND p.role='CUSTOMER' AND u.email_confirmed_at IS NOT NULL AND nullif(btrim(u.email),'') IS NOT NULL) THEN
  -- Lock the firm's choice until insertion commits; closing candidacy cannot race it.
  PERFORM 1 FROM public.companies WHERE id=NEW.company_id AND accepts_driver_applications
   AND is_active AND setup_completed_at IS NOT NULL AND document_checks_required AND price_per_km>0 AND currency='EUR' FOR SHARE;
  IF FOUND THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Необходима е лична покана или фирма с отворено кандидатстване.' USING ERRCODE='42501';
END $fn$;
REVOKE ALL ON FUNCTION private.guard_invited_driver_application() FROM PUBLIC,anon,authenticated;

-- Rules change rarely; record their exact before/after values in the existing
-- company-scoped audit log, without adding traffic to dispatch or reporting.
CREATE FUNCTION private.audit_company_rules() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,old_value,new_value)
 VALUES(NEW.id,auth.uid(),'company',NEW.id,'company_rules_changed',
  jsonb_build_object('base_fare',OLD.base_fare,'min_fare',OLD.min_fare,'price_per_km',OLD.price_per_km,
   'price_per_minute',OLD.price_per_minute,'currency',OLD.currency,'dispatch_radius_km',OLD.dispatch_radius_km,
   'accepts_driver_applications',OLD.accepts_driver_applications,'document_checks_required',OLD.document_checks_required),
  jsonb_build_object('base_fare',NEW.base_fare,'min_fare',NEW.min_fare,'price_per_km',NEW.price_per_km,
   'price_per_minute',NEW.price_per_minute,'currency',NEW.currency,'dispatch_radius_km',NEW.dispatch_radius_km,
   'accepts_driver_applications',NEW.accepts_driver_applications,'document_checks_required',NEW.document_checks_required));
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.audit_company_rules() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER audit_company_rules AFTER UPDATE ON public.companies FOR EACH ROW
 WHEN ((OLD.base_fare,OLD.min_fare,OLD.price_per_km,OLD.price_per_minute,OLD.currency,OLD.dispatch_radius_km,OLD.accepts_driver_applications,OLD.document_checks_required)
 IS DISTINCT FROM (NEW.base_fare,NEW.min_fare,NEW.price_per_km,NEW.price_per_minute,NEW.currency,NEW.dispatch_radius_km,NEW.accepts_driver_applications,NEW.document_checks_required))
 EXECUTE FUNCTION private.audit_company_rules();

-- A cash count must never be used as proof of a card receipt. Keep this in the
-- shared core so the legacy verified endpoint cannot bypass the new UI.
CREATE OR REPLACE FUNCTION private.record_driver_money_verified(p_id uuid, p_kind text, p_amount numeric, p_note text, p_actor uuid, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid, p_source text DEFAULT 'declaration'::text, p_evidence_ref text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE result uuid; previous public.driver_money_entries; ref text:=nullif(btrim(p_evidence_ref),'');
BEGIN
 IF auth.uid() IS NULL OR NOT private.staff_mfa_allowed() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Account changed' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_source IS NULL OR p_source NOT IN ('declaration','cash_count','cash_book','receipt','bank_record') OR length(ref)>160 THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 IF p_kind='confirmation' OR (p_kind='reversal' AND EXISTS(
  SELECT 1 FROM public.driver_money_entries c WHERE c.reference_id=p_reference_id AND c.kind='confirmation'
 )) THEN
  IF p_source='declaration' OR (p_source<>'cash_count' AND ref IS NULL) THEN RAISE EXCEPTION 'Confirmation needs a source and reference'; END IF;
 ELSIF p_source<>'declaration' OR ref IS NOT NULL THEN RAISE EXCEPTION 'Only a company confirmation or correction can verify evidence'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND AND (previous.evidence_source IS DISTINCT FROM p_source OR previous.evidence_reference IS DISTINCT FROM ref) THEN RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505'; END IF;
 result:=private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
 IF previous.id IS NULL AND p_kind IN ('confirmation','reversal') AND p_source IN ('cash_count','cash_book') AND EXISTS(
  SELECT 1 FROM public.driver_money_entries WHERE id=p_reference_id AND payment_method='card'
 ) THEN
  RAISE EXCEPTION 'Картово плащане се сверява с платежен запис или документ от терминала.' USING ERRCODE='22023';
 END IF;
 IF previous.id IS NULL THEN UPDATE public.driver_money_entries SET evidence_source=p_source,evidence_reference=ref WHERE id=result; END IF;
 RETURN result;
END $fn$;
NOTIFY pgrst,'reload schema';
COMMIT;
