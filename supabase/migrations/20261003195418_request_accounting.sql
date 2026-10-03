-- Request-level reports: no shifts, no automatic cash or cancellation charges.
CREATE TABLE public.request_outcomes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL UNIQUE REFERENCES public.taxi_requests(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 driver_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
 outcome text NOT NULL CHECK(outcome IN ('completed','cancelled')),
 previous_status text NOT NULL,
 cancelled_by text, cancel_reason text,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL,
 accepted_at timestamptz, started_at timestamptz,
 booked_amount numeric(12,2), estimated_distance_km double precision,
 reconstructed boolean NOT NULL DEFAULT false
);
CREATE INDEX request_outcomes_company_time ON public.request_outcomes(company_id,occurred_at DESC,id);
CREATE INDEX request_outcomes_driver_time ON public.request_outcomes(driver_user_id,occurred_at DESC,id);
ALTER TABLE public.request_outcomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.request_outcomes FROM anon,authenticated;
GRANT SELECT ON public.request_outcomes TO authenticated;
CREATE POLICY outcomes_read ON public.request_outcomes FOR SELECT TO authenticated USING (
 public.is_company_admin(company_id) OR public.is_super_admin() OR
 (driver_user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='DRIVER'))
);
CREATE FUNCTION private.record_request_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.status IN ('completed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO public.request_outcomes(request_id,company_id,driver_id,driver_user_id,vehicle_id,outcome,previous_status,cancelled_by,cancel_reason,actor_id,occurred_at,accepted_at,started_at,booked_amount,estimated_distance_km)
  SELECT NEW.id,NEW.company_id,NEW.driver_id,d.user_id,d.vehicle_id,NEW.status::text,OLD.status::text,
   NEW.cancelled_by::text,left(coalesce(nullif(btrim(NEW.cancel_reason),''),'not_provided'),500),
   CASE WHEN NEW.cancelled_by='system' THEN NULL ELSE auth.uid() END,
   coalesce(NEW.completed_at,NEW.cancelled_at,clock_timestamp()),NEW.accepted_at,NEW.started_at,
   CASE WHEN NEW.status='completed' THEN NEW.final_price ELSE NULL END,NEW.estimated_distance_km
  FROM (SELECT 1) seed LEFT JOIN public.drivers d ON d.id=NEW.driver_id
  ON CONFLICT(request_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.record_request_outcome() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER record_request_outcome AFTER UPDATE ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.record_request_outcome();
-- Older outcomes are explicitly reconstructed; do not invent an actor or measured distance.
INSERT INTO public.request_outcomes(request_id,company_id,driver_id,driver_user_id,vehicle_id,outcome,previous_status,cancelled_by,cancel_reason,occurred_at,accepted_at,started_at,booked_amount,estimated_distance_km,reconstructed)
SELECT r.id,r.company_id,r.driver_id,d.user_id,NULL,r.status::text,
 CASE WHEN r.status='completed' OR r.started_at IS NOT NULL THEN 'in_progress' WHEN r.arrived_at IS NOT NULL THEN 'arrived' WHEN r.accepted_at IS NOT NULL THEN 'accepted' ELSE 'pending' END,
 r.cancelled_by::text,coalesce(nullif(btrim(r.cancel_reason),''),'not_provided'),coalesce(r.completed_at,r.cancelled_at,r.updated_at),r.accepted_at,r.started_at,
 CASE WHEN r.status='completed' THEN r.final_price ELSE NULL END,r.estimated_distance_km,true
FROM public.taxi_requests r LEFT JOIN public.drivers d ON d.id=r.driver_id WHERE r.status IN ('completed','cancelled');

CREATE TABLE public.driver_money_entries (
 id uuid PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
 driver_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('income','expense','handover','confirmation','reversal')),
 amount numeric(12,2) NOT NULL CHECK(amount>0 AND amount<=1000000),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 request_id uuid REFERENCES public.taxi_requests(id) ON DELETE SET NULL,
 reference_id uuid REFERENCES public.driver_money_entries(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((kind IN ('confirmation','reversal'))=(reference_id IS NOT NULL))
);
CREATE UNIQUE INDEX money_reference_kind_unique ON public.driver_money_entries(reference_id,kind) WHERE reference_id IS NOT NULL;
CREATE INDEX money_company_time ON public.driver_money_entries(company_id,recorded_at DESC,id);
CREATE INDEX money_driver_time ON public.driver_money_entries(driver_user_id,recorded_at DESC,id);
ALTER TABLE public.driver_money_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_money_entries FROM anon,authenticated;
GRANT SELECT ON public.driver_money_entries TO authenticated;
CREATE POLICY money_read ON public.driver_money_entries FOR SELECT TO authenticated USING (
 public.is_company_admin(company_id) OR public.is_super_admin() OR
 (driver_user_id=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_active AND p.role='DRIVER'))
);
-- All writes are server-validated, append-only for clients, and idempotent by client operation UUID.
CREATE FUNCTION private.record_driver_money(p_id uuid,p_kind text,p_amount numeric,p_note text,p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d public.drivers; original public.driver_money_entries; existing public.driver_money_entries; uid uuid:=auth.uid(); cid uuid; did uuid; owner_id uuid; amt numeric;
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('income','expense','handover','confirmation','reversal') OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid entry'; END IF;
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
   IF original.kind<>'handover' OR original.actor_id=uid OR NOT(public.is_company_admin(original.company_id) OR public.is_super_admin()) THEN RAISE EXCEPTION 'Only a different company administrator can confirm receipt' USING ERRCODE='42501'; END IF;
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
END $$;
REVOKE ALL ON FUNCTION private.record_driver_money(uuid,text,numeric,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.record_driver_money(uuid,text,numeric,text,uuid,uuid) TO authenticated;
CREATE FUNCTION public.record_driver_money(p_id uuid,p_kind text,p_amount numeric,p_note text,p_request_id uuid DEFAULT NULL,p_reference_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.record_driver_money(p_id,p_kind,p_amount,p_note,p_request_id,p_reference_id); $$;
REVOKE ALL ON FUNCTION public.record_driver_money(uuid,text,numeric,text,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.record_driver_money(uuid,text,numeric,text,uuid,uuid) TO authenticated;

CREATE FUNCTION public.accounting_report(p_from date,p_until date,p_company_id uuid DEFAULT NULL,p_driver_id uuid DEFAULT NULL,p_page integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
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
   coalesce(sum(amount) FILTER(WHERE kind='handover' AND NOT reversed AND confirmed),0) confirmed_handover FROM money
 ) SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),'finances',(SELECT to_jsonb(f) FROM finances f),
 'outcome_count',(SELECT count(*) FROM outcomes),'entry_count',(SELECT count(*) FROM money),
 'outcomes',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM outcomes ORDER BY occurred_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'entries',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT * FROM money ORDER BY recorded_at DESC,id LIMIT 25 OFFSET p_page*25) x),'[]'::jsonb),
 'drivers',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (SELECT driver_id,max(driver_name) driver_name,count(*) FILTER(WHERE outcome='completed') trips,count(*) FILTER(WHERE outcome='cancelled') cancelled,coalesce(sum(booked_amount),0) booked FROM outcomes GROUP BY driver_id ORDER BY sum(booked_amount) DESC NULLS LAST LIMIT 50) x),'[]'::jsonb)) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.accounting_report(date,date,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_report(date,date,uuid,uuid,integer) TO authenticated;
