-- Compatibility for the currently published frontend until quote-cutover.sql runs.
-- Client route metrics remain untrusted on this legacy path; the new frontend does not use it.
CREATE OR REPLACE FUNCTION private.guard_legacy_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c public.companies; v public.vehicle_types; b numeric; k numeric; m numeric;
BEGIN
 IF current_user IN ('postgres','service_role','supabase_admin') THEN RETURN NEW; END IF;
 IF NEW.customer_id IS DISTINCT FROM auth.uid() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND is_active AND role='CUSTOMER') THEN
 RAISE EXCEPTION 'Active customer required' USING ERRCODE='42501'; END IF;
 IF NEW.status<>'pending' OR NEW.driver_id IS NOT NULL OR NEW.payment_status<>'pending'
 OR NEW.final_price IS NOT NULL THEN RAISE EXCEPTION 'A new ride must be pending and unassigned'; END IF;
 IF NOT (NEW.pickup_latitude BETWEEN -90 AND 90 AND NEW.pickup_longitude BETWEEN -180 AND 180
 AND NEW.destination_latitude BETWEEN -90 AND 90 AND NEW.destination_longitude BETWEEN -180 AND 180)
 OR NEW.destination_latitude IS NULL OR NEW.destination_longitude IS NULL
 OR NEW.estimated_distance_km IS NULL OR NOT(NEW.estimated_distance_km BETWEEN 0 AND 3000)
 OR NEW.estimated_duration_min IS NULL OR NOT(NEW.estimated_duration_min BETWEEN 0 AND 3000) THEN RAISE EXCEPTION 'Invalid route'; END IF;
 SELECT * INTO c FROM public.companies WHERE id=NEW.company_id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Company unavailable'; END IF;
 SELECT * INTO v FROM public.vehicle_types WHERE id=NEW.vehicle_type_id AND company_id=c.id AND is_active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle type unavailable'; END IF;
 b:=round(c.base_fare*v.multiplier,2);k:=round(c.price_per_km*v.multiplier,2);m:=round(c.price_per_minute*v.multiplier,2);
 NEW.estimated_price:=b+round(NEW.estimated_distance_km::numeric*k,2)+round(NEW.estimated_duration_min*m,2);
 NEW.fare_breakdown:=jsonb_build_object('source','legacy_client_route','total',NEW.estimated_price);
 NEW.created_at:=now();NEW.requested_at:=now();NEW.updated_at:=now();
 NEW.accepted_at:=NULL;NEW.arrived_at:=NULL;NEW.started_at:=NULL;NEW.completed_at:=NULL;NEW.cancelled_at:=NULL;NEW.cancelled_by:=NULL;NEW.cancel_reason:=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_legacy_insert BEFORE INSERT ON public.taxi_requests FOR EACH ROW EXECUTE FUNCTION private.guard_legacy_insert();
REVOKE ALL ON FUNCTION private.guard_legacy_insert() FROM PUBLIC,anon,authenticated;
