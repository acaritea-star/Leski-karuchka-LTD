-- Additive PWA reliability, evidence and legal workflow. No shifts or automatic erasure.
ALTER TABLE public.driver_money_entries ADD COLUMN evidence_source text NOT NULL DEFAULT 'declaration'
 CHECK(evidence_source IN ('declaration','cash_count','cash_book','receipt','bank_record')),
 ADD COLUMN evidence_reference text CHECK(length(evidence_reference)<=160);
CREATE FUNCTION private.record_driver_money_core(p_id uuid, p_kind text, p_amount numeric, p_note text, p_request_id uuid DEFAULT NULL::uuid, p_reference_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.drivers; original public.driver_money_entries; existing public.driver_money_entries; uid uuid:=auth.uid(); cid uuid; did uuid; owner_id uuid; amt numeric;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('income','expense','handover','confirmation','reversal') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid entry'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO existing FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND THEN
  IF existing.actor_id=uid AND existing.kind=p_kind AND existing.note=btrim(p_note) AND existing.request_id IS NOT DISTINCT FROM p_request_id AND existing.reference_id IS NOT DISTINCT FROM p_reference_id
   AND (p_kind IN ('confirmation','reversal') OR existing.amount=p_amount) THEN RETURN p_id; END IF;
  RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505';
 END IF;
 IF p_kind IN ('confirmation','reversal') THEN
  SELECT * INTO original FROM public.driver_money_entries WHERE id=p_reference_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='reversal') THEN RAISE EXCEPTION 'Entry already reversed'; END IF;
  IF p_kind='confirmation' THEN
   IF original.kind NOT IN ('handover','income') OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Only a different company administrator can confirm receipt' USING ERRCODE='42501'; END IF;
  ELSE
   IF original.actor_id IS DISTINCT FROM uid OR original.kind NOT IN ('income','expense','handover') OR NOT public.is_driver(original.driver_id) THEN RAISE EXCEPTION 'Only your own unconfirmed entry can be reversed' USING ERRCODE='42501'; END IF;
   IF EXISTS(SELECT 1 FROM public.driver_money_entries WHERE reference_id=original.id AND kind='confirmation') THEN RAISE EXCEPTION 'Confirmed handover cannot be reversed'; END IF;
  END IF;
  cid:=original.company_id;did:=original.driver_id;owner_id:=original.driver_user_id;amt:=original.amount;
  IF p_request_id IS NOT NULL THEN RAISE EXCEPTION 'Reference operation cannot set a request'; END IF;
 ELSE
  IF p_reference_id IS NOT NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000 OR p_amount<>round(p_amount,2) THEN RAISE EXCEPTION 'Invalid amount or reference'; END IF;
  SELECT * INTO d FROM public.drivers WHERE user_id=uid;
  IF NOT FOUND OR NOT public.is_driver(d.id) THEN RAISE EXCEPTION 'Driver account required' USING ERRCODE='42501'; END IF;
  cid:=d.company_id;did:=d.id;owner_id:=uid;amt:=p_amount;
  IF p_request_id IS NOT NULL AND (p_kind<>'income' OR NOT EXISTS(SELECT 1 FROM public.taxi_requests WHERE id=p_request_id AND driver_id=d.id AND company_id=d.company_id AND status='completed')) THEN RAISE EXCEPTION 'Income can only link to your completed ride' USING ERRCODE='42501'; END IF;
  IF p_request_id IS NOT NULL THEN
   PERFORM 1 FROM public.taxi_requests WHERE id=p_request_id FOR UPDATE;
   IF EXISTS(SELECT 1 FROM public.driver_money_entries e WHERE e.request_id=p_request_id AND e.kind='income' AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')) THEN RAISE EXCEPTION 'Income already recorded for this ride'; END IF;
  END IF;
 END IF;
 INSERT INTO public.driver_money_entries(id,company_id,driver_id,driver_user_id,actor_id,kind,amount,note,request_id,reference_id) VALUES(p_id,cid,did,owner_id,uid,p_kind,amt,btrim(p_note),p_request_id,p_reference_id);
 RETURN p_id;
END; $function$;
REVOKE ALL ON FUNCTION private.record_driver_money_core(uuid,text,numeric,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Keep the old client API compatible, but income verification must include evidence.
CREATE OR REPLACE FUNCTION private.record_driver_money(p_id uuid,p_kind text,p_amount numeric,p_note text,p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_kind='confirmation' AND EXISTS(SELECT 1 FROM public.driver_money_entries WHERE id=p_reference_id AND kind='income') THEN
  RAISE EXCEPTION 'Use the verified confirmation API with an evidence source' USING ERRCODE='42501';
 END IF;
 RETURN private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
END $$;

CREATE OR REPLACE FUNCTION public.accounting_report(p_from date, p_until date, p_company_id uuid DEFAULT NULL::uuid, p_driver_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_from IS NULL OR p_until IS NULL OR p_until<=p_from OR p_until-p_from>366 OR p_page IS NULL OR p_page<0 OR p_page>10000 THEN RAISE EXCEPTION 'Invalid report period'; END IF;
 IF p_driver_id IS NULL AND (p_company_id IS NULL OR NOT(public.is_company_admin(p_company_id) OR public.is_super_admin())) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 IF p_driver_id IS NOT NULL AND NOT(public.is_driver(p_driver_id) OR EXISTS(SELECT 1 FROM public.drivers d WHERE d.id=p_driver_id AND (public.is_company_admin(d.company_id) OR public.is_super_admin()))) THEN RAISE EXCEPTION 'Report scope not allowed' USING ERRCODE='42501'; END IF;
 WITH outcomes AS MATERIALIZED (
  SELECT o.*,concat_ws(' ',p.first_name,p.last_name) driver_name FROM public.request_outcomes o LEFT JOIN public.profiles p ON p.id=o.driver_user_id WHERE (p_company_id IS NULL OR o.company_id=p_company_id) AND (p_driver_id IS NULL OR o.driver_id=p_driver_id)
   AND o.occurred_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND o.occurred_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), money AS MATERIALIZED (
  SELECT e.*,concat_ws(' ',p.first_name,p.last_name) driver_name,EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal') reversed,
   EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='confirmation') confirmed
  FROM public.driver_money_entries e LEFT JOIN public.profiles p ON p.id=e.driver_user_id WHERE (p_company_id IS NULL OR e.company_id=p_company_id) AND (p_driver_id IS NULL OR e.driver_id=p_driver_id)
   AND e.recorded_at>=p_from::timestamp AT TIME ZONE 'Europe/Sofia' AND e.recorded_at<p_until::timestamp AT TIME ZONE 'Europe/Sofia'
 ), totals AS (
  SELECT count(*) FILTER(WHERE outcome='completed') completed,count(*) FILTER(WHERE outcome='cancelled') cancelled,
   count(*) FILTER(WHERE outcome='cancelled' AND previous_status='in_progress') interrupted,
   coalesce(sum(booked_amount) FILTER(WHERE outcome='completed'),0) booked,
   count(*) FILTER(WHERE outcome='completed' AND booked_amount IS NULL) missing_amounts FROM outcomes
 ), finances AS (
  SELECT coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed),0) income,
   coalesce(sum(amount) FILTER(WHERE kind='expense' AND NOT reversed),0) expenses,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed),0) handed_over,
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed AND confirmed),0) confirmed_handover,
   coalesce(sum(amount) FILTER(WHERE kind='income' AND NOT reversed AND confirmed),0) confirmed_income FROM money
 ) SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),
 'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM money),
 'reconciliation',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
 SELECT o.request_id,o.booked_amount estimated_amount,e.amount declared_income,e.recorded_at income_recorded_at,
 EXISTS(SELECT 1 FROM public.driver_money_entries conf WHERE conf.reference_id=e.id AND conf.kind='confirmation') company_confirmed,
 e.amount-o.booked_amount difference
 FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) o
 LEFT JOIN LATERAL (SELECT e.* FROM public.driver_money_entries e WHERE e.request_id=o.request_id AND e.kind='income'
  AND NOT EXISTS(SELECT 1 FROM public.driver_money_entries v WHERE v.reference_id=e.id AND v.kind='reversal')
  ORDER BY e.recorded_at DESC,e.id LIMIT 1) e ON true
 WHERE o.outcome='completed')x),'[]'::jsonb),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END; $function$;

CREATE FUNCTION private.record_driver_money_verified(p_id uuid,p_kind text,p_amount numeric,p_note text,p_actor uuid,p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL,p_source text DEFAULT 'declaration',p_evidence_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; previous public.driver_money_entries; ref text:=nullif(btrim(p_evidence_ref),'');
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_actor IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Account changed' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_source IS NULL OR p_source NOT IN ('declaration','cash_count','cash_book','receipt','bank_record') OR length(ref)>160 THEN RAISE EXCEPTION 'Invalid evidence'; END IF;
 IF p_kind='confirmation' THEN
  IF p_source='declaration' OR (p_source<>'cash_count' AND ref IS NULL) THEN RAISE EXCEPTION 'Confirmation needs a source and reference'; END IF;
 ELSIF p_source<>'declaration' OR ref IS NOT NULL THEN RAISE EXCEPTION 'Only a company confirmation can verify evidence'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO previous FROM public.driver_money_entries WHERE id=p_id;
 IF FOUND AND (previous.evidence_source IS DISTINCT FROM p_source OR previous.evidence_reference IS DISTINCT FROM ref) THEN RAISE EXCEPTION 'Operation ID already used' USING ERRCODE='23505'; END IF;
 result:=private.record_driver_money_core(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id);
 IF previous.id IS NULL THEN UPDATE public.driver_money_entries SET evidence_source=p_source,evidence_reference=ref WHERE id=result; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.record_driver_money_verified(uuid,text,numeric,text,uuid,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.record_driver_money_verified(uuid,text,numeric,text,uuid,uuid,uuid,text,text) TO authenticated;
CREATE FUNCTION public.record_driver_money_verified(p_id uuid,p_kind text,p_amount numeric,p_note text,p_actor uuid,p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL,p_source text DEFAULT 'declaration',p_evidence_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.record_driver_money_verified(p_id,p_kind,p_amount,p_note,p_actor,p_request_id,p_reference_id,p_source,p_evidence_ref); $$;
REVOKE ALL ON FUNCTION public.record_driver_money_verified(uuid,text,numeric,text,uuid,uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_driver_money_verified(uuid,text,numeric,text,uuid,uuid,uuid,text,text) TO authenticated;

CREATE TABLE private.legal_versions (
 terms_version text NOT NULL, privacy_version text NOT NULL, source_digest text NOT NULL,
 is_current boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(terms_version,privacy_version)
);
CREATE UNIQUE INDEX legal_current_unique ON private.legal_versions(is_current) WHERE is_current;
ALTER TABLE private.legal_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.legal_versions FROM PUBLIC,anon,authenticated;
INSERT INTO private.legal_versions(terms_version,privacy_version,source_digest) VALUES ('2026-10-03-draft.2','2026-10-04.2','7ef2efe56f86edb88aa1c75ec5f9f538ea224f022dfbe58b67544b1674ea5a75');
CREATE TABLE public.legal_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 terms_version text NOT NULL, privacy_version text NOT NULL, source_digest text NOT NULL,
 method text NOT NULL CHECK(method IN ('google','facebook','continue')), accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(user_id,terms_version,privacy_version)
);
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.legal_acceptances FROM anon,authenticated;
GRANT SELECT ON public.legal_acceptances TO authenticated;
CREATE POLICY legal_acceptances_owner ON public.legal_acceptances FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE FUNCTION private.accept_legal_versions(p_terms text,p_privacy text,p_method text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT source_digest INTO digest FROM private.legal_versions WHERE is_current AND terms_version=p_terms AND privacy_version=p_privacy;
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.accept_legal_versions(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.accept_legal_versions(text,text,text) TO authenticated;
CREATE FUNCTION public.accept_legal_versions(p_terms text,p_privacy text,p_method text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.accept_legal_versions(p_terms,p_privacy,p_method); $$;
REVOKE ALL ON FUNCTION public.accept_legal_versions(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accept_legal_versions(text,text,text) TO authenticated;

ALTER TABLE public.driver_documents ADD COLUMN reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.companies ADD COLUMN legal_name text CHECK(length(legal_name)<=200),
 ADD COLUMN registration_id text CHECK(registration_id IS NULL OR registration_id ~ '^([0-9]{9}|[0-9]{13})$'),
 ADD COLUMN permit_number text CHECK(length(permit_number)<=100),
 ADD COLUMN permit_expires_on date, ADD COLUMN legal_verified_at timestamptz,
 ADD COLUMN legal_verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 ADD COLUMN document_checks_required boolean NOT NULL DEFAULT false;
CREATE FUNCTION private.guard_carrier_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE requested boolean:=NEW.legal_verified_at IS DISTINCT FROM OLD.legal_verified_at AND NEW.legal_verified_at IS NOT NULL;
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF (NEW.legal_name,NEW.registration_id,NEW.address,NEW.permit_number,NEW.permit_expires_on) IS DISTINCT FROM
 (OLD.legal_name,OLD.registration_id,OLD.address,OLD.permit_number,OLD.permit_expires_on) THEN
  NEW.legal_verified_at:=NULL; NEW.legal_verified_by:=NULL;
 END IF;
 IF requested THEN
   IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Only the platform administrator can verify carrier identity' USING ERRCODE='42501'; END IF;
   IF nullif(btrim(NEW.legal_name),'') IS NULL OR NEW.registration_id IS NULL OR nullif(btrim(NEW.address),'') IS NULL
    OR nullif(btrim(NEW.permit_number),'') IS NULL OR NEW.permit_expires_on IS NULL OR NEW.permit_expires_on<(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date THEN RAISE EXCEPTION 'Complete valid carrier identity before verification'; END IF;
   NEW.legal_verified_at:=clock_timestamp(); NEW.legal_verified_by:=auth.uid();
 ELSIF NEW.legal_verified_at IS NULL THEN NEW.legal_verified_by:=NULL;
 ELSIF NEW.legal_verified_by IS DISTINCT FROM OLD.legal_verified_by THEN RAISE EXCEPTION 'Verification fields are protected' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_carrier_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_carrier_identity BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.guard_carrier_identity();
CREATE FUNCTION public.carrier_identity(p_company uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',id,'name',name,'legal_name',legal_name,'registration_id',registration_id,'address',address,'phone',phone,
 'permit_number',permit_number,'permit_expires_on',permit_expires_on,
 'verified',legal_verified_at IS NOT NULL AND permit_expires_on>=(clock_timestamp() AT TIME ZONE 'Europe/Sofia')::date)
 FROM public.companies WHERE id=p_company AND is_active;
$$;
REVOKE ALL ON FUNCTION public.carrier_identity(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.carrier_identity(uuid) TO authenticated;

CREATE INDEX driver_documents_validity ON public.driver_documents(driver_id,type,status,expires_at);
CREATE FUNCTION private.driver_documents_ready(p_driver uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.companies c ON c.id=d.company_id LEFT JOIN public.vehicles v ON v.id=d.vehicle_id
 WHERE d.id=p_driver
 AND (v.insurance_expiry_date IS NULL OR v.insurance_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND (v.inspection_expiry_date IS NULL OR v.inspection_expiry_date>=(now() AT TIME ZONE 'Europe/Sofia')::date)
 AND NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type IN ('license','insurance') AND x.status='approved'
  AND x.expires_at<(now() AT TIME ZONE 'Europe/Sofia')::date
  AND NOT EXISTS(SELECT 1 FROM public.driver_documents y WHERE y.driver_id=d.id AND y.type=x.type AND y.status='approved' AND y.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))
 AND (NOT c.document_checks_required OR NOT EXISTS(
  SELECT 1 FROM unnest(ARRAY['license','insurance']) required(type)
  WHERE NOT EXISTS(SELECT 1 FROM public.driver_documents x WHERE x.driver_id=d.id AND x.type::text=required.type AND x.status='approved' AND x.expires_at>=(now() AT TIME ZONE 'Europe/Sofia')::date))));
$$;
REVOKE ALL ON FUNCTION private.driver_documents_ready(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.driver_documents_ready(uuid) TO authenticated;
CREATE FUNCTION private.guard_document_validity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN NEW.status:='pending'; NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL; END IF;
 IF TG_OP='UPDATE' AND (NEW.driver_id,NEW.company_id,NEW.type) IS DISTINCT FROM (OLD.driver_id,OLD.company_id,OLD.type) THEN RAISE EXCEPTION 'Document ownership is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND NEW.file_url IS DISTINCT FROM OLD.file_url THEN NEW.status:='pending'; NEW.reviewed_by:=NULL; END IF;
 IF NEW.status='approved' THEN
  IF NOT(public.is_company_admin(NEW.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Company administrator required' USING ERRCODE='42501'; END IF;
  IF NEW.type IN ('license','insurance') AND (NEW.expires_at IS NULL OR NEW.expires_at<(now() AT TIME ZONE 'Europe/Sofia')::date) THEN RAISE EXCEPTION 'A valid expiry date is required'; END IF;
  IF TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
   NEW.reviewed_at:=clock_timestamp(); NEW.reviewed_by:=auth.uid();
  ELSE NEW.reviewed_at:=OLD.reviewed_at; NEW.reviewed_by:=OLD.reviewed_by; END IF;
 ELSE NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_document_validity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_document_validity BEFORE INSERT OR UPDATE ON public.driver_documents FOR EACH ROW EXECUTE FUNCTION private.guard_document_validity();
CREATE FUNCTION private.guard_dispatch_documents() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='drivers' THEN
  IF NEW.is_online AND (TG_OP='INSERT' OR NOT OLD.is_online) AND NOT private.driver_documents_ready(NEW.id) THEN RAISE EXCEPTION 'Документите или сроковете на автомобила изискват проверка.'; END IF;
 ELSE
  IF OLD.status='pending' AND NEW.status='accepted' AND NOT private.driver_documents_ready(NEW.driver_id) THEN RAISE EXCEPTION 'Driver documents require review'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_dispatch_documents() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_online_documents BEFORE UPDATE OF is_online ON public.drivers FOR EACH ROW EXECUTE FUNCTION private.guard_dispatch_documents();
CREATE TRIGGER guard_accept_documents BEFORE UPDATE OF status ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_dispatch_documents();

CREATE TABLE public.privacy_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('export','deletion')),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),resolved_at timestamptz,resolution text CHECK(length(resolution)<=1000)
);
CREATE UNIQUE INDEX privacy_open_unique ON public.privacy_requests(user_id,kind) WHERE status IN ('pending','in_progress');
CREATE INDEX privacy_requests_owner_time ON public.privacy_requests(user_id,created_at DESC);
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_requests FROM anon,authenticated;
GRANT SELECT ON public.privacy_requests TO authenticated;
CREATE POLICY privacy_requests_read ON public.privacy_requests FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()) OR (SELECT public.is_super_admin()));
CREATE FUNCTION private.request_personal_data(p_kind text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result uuid; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_kind IS NULL OR p_kind NOT IN ('export','deletion') THEN RAISE EXCEPTION 'Invalid privacy request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(uid::text||':privacy:'||p_kind,0));
 SELECT id INTO result FROM public.privacy_requests WHERE user_id=uid AND kind=p_kind AND status IN ('pending','in_progress');
 IF result IS NULL THEN INSERT INTO public.privacy_requests(user_id,kind) VALUES(uid,p_kind) RETURNING id INTO result; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.request_personal_data(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.request_personal_data(text) TO authenticated;
CREATE FUNCTION public.request_personal_data(p_kind text) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.request_personal_data(p_kind); $$;
REVOKE ALL ON FUNCTION public.request_personal_data(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_personal_data(text) TO authenticated;
CREATE FUNCTION private.resolve_privacy_request(p_id uuid,p_status text,p_note text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_super_admin() THEN RAISE EXCEPTION 'Platform administrator required' USING ERRCODE='42501'; END IF;
 IF p_status IS NULL OR p_status NOT IN ('in_progress','completed','rejected') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Explain the processing outcome'; END IF;
 UPDATE public.privacy_requests SET status=p_status,resolution=btrim(p_note),resolved_at=CASE WHEN p_status IN ('completed','rejected') THEN clock_timestamp() ELSE NULL END
 WHERE id=p_id AND status IN ('pending','in_progress');
 IF NOT FOUND THEN RAISE EXCEPTION 'Privacy request is already closed or missing'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.resolve_privacy_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.resolve_privacy_request(uuid,text,text) TO authenticated;
CREATE FUNCTION public.resolve_privacy_request(p_id uuid,p_status text,p_note text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.resolve_privacy_request(p_id,p_status,p_note); $$;
REVOKE ALL ON FUNCTION public.resolve_privacy_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.resolve_privacy_request(uuid,text,text) TO authenticated;
CREATE FUNCTION public.export_my_basic_data() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); result jsonb;
BEGIN
 IF uid IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('generated_at',clock_timestamp(),'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=uid),
 'legal_acceptances',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.legal_acceptances WHERE user_id=uid ORDER BY accepted_at DESC LIMIT 1000)x),'[]'::jsonb),
 'privacy_requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.privacy_requests WHERE user_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'money_entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM public.driver_money_entries WHERE driver_user_id=uid ORDER BY recorded_at DESC LIMIT 1000)x),'[]'::jsonb),
 'requests',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT id,status,created_at,pickup_address,destination_address,estimated_price FROM public.taxi_requests WHERE customer_id=uid ORDER BY created_at DESC LIMIT 1000)x),'[]'::jsonb),
 'scope','Basic account data, at most 1000 records per list. Request a full export for additional data.') INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.export_my_basic_data() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.export_my_basic_data() TO authenticated;

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
    AND l.updated_at > clock_timestamp()-interval '45 seconds'
    AND l.position_at > clock_timestamp()-interval '45 seconds'
    AND l.accuracy BETWEEN 0 AND 100
    AND l.position_at <= clock_timestamp()+interval '30 seconds'
    AND p_lat BETWEEN -90 AND 90 AND p_lng BETWEEN -180 AND 180
    AND c.dispatch_radius_km > 0
    AND public.st_dwithin(l.geo,
      public.st_setsrid(public.st_makepoint(p_lng,p_lat),4326)::public.geography,
      c.dispatch_radius_km::double precision*1000)
    AND NOT EXISTS(SELECT 1 FROM public.taxi_requests r
      WHERE r.driver_id=d.id AND r.status IN ('accepted','arrived','in_progress'));
$function$;

CREATE INDEX money_income_request_lookup ON public.driver_money_entries(request_id) WHERE kind='income' AND request_id IS NOT NULL;
CREATE INDEX document_reviewer_lookup ON public.driver_documents(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX carrier_reviewer_lookup ON public.companies(legal_verified_by) WHERE legal_verified_by IS NOT NULL;
