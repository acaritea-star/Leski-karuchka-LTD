-- Protect carrier verification on creation too; known expired permits stop new work.
CREATE OR REPLACE FUNCTION private.guard_carrier_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE requested boolean;
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 requested:=NEW.legal_verified_at IS NOT NULL AND (TG_OP='INSERT' OR NEW.legal_verified_at IS DISTINCT FROM OLD.legal_verified_at);
 IF TG_OP='UPDATE' AND (NEW.legal_name,NEW.registration_id,NEW.address,NEW.permit_number,NEW.permit_expires_on) IS DISTINCT FROM
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
DROP TRIGGER guard_carrier_identity ON public.companies;
CREATE TRIGGER guard_carrier_identity BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.guard_carrier_identity();

CREATE OR REPLACE FUNCTION private.driver_documents_ready(p_driver uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.drivers d JOIN public.companies c ON c.id=d.company_id LEFT JOIN public.vehicles v ON v.id=d.vehicle_id
 WHERE d.id=p_driver
 AND (c.permit_expires_on IS NULL OR c.permit_expires_on>=(now() AT TIME ZONE 'Europe/Sofia')::date)
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
