-- Verify the recipient again at the single-use worker claim boundary.
-- No grants, delivery schedule or app-facing API shape changes.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_push_job(p_job_id uuid,p_lease_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE j private.push_outbox; r public.taxi_requests; n public.notifications; valid boolean:=true;
BEGIN
 SELECT * INTO j FROM private.push_outbox WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_lease_token
 OR j.lease_until<=clock_timestamp() OR j.claimed_at IS NOT NULL THEN RETURN NULL; END IF;
 valid:=(j.payload#>>'{data,recipient_id}') IS NOT DISTINCT FROM j.recipient_id::text;
 IF j.notification_id IS NOT NULL THEN
  SELECT * INTO n FROM public.notifications WHERE id=j.notification_id;
  valid:=valid AND FOUND AND n.user_id=j.recipient_id
   AND (j.payload#>>'{data,notification_id}') IS NOT DISTINCT FROM n.id::text AND NOT n.is_read AND private.notification_recipient_valid(j.recipient_id,n.audience,n.company_id);
  IF n.type='application_submitted' THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_applications a WHERE a.id=(n.data->>'application_id')::uuid
    AND a.company_id=n.company_id AND a.status='pending' AND (NOT a.onboarding_required OR a.submitted_at IS NOT NULL));
  ELSIF n.type IN ('application_approved','application_rejected') THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_applications a WHERE a.id=(n.data->>'application_id')::uuid
    AND a.user_id=n.user_id AND a.company_id=n.company_id AND 'application_'||a.status=n.type);
  ELSIF n.type IN ('document_submitted','document_approved','document_rejected','document_expiring') THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.driver_documents d WHERE d.id=(n.data->>'document_id')::uuid
    AND d.company_id=n.company_id AND ((n.type='document_submitted' AND d.status='pending') OR
     (n.type='document_approved' AND d.status='approved') OR (n.type='document_rejected' AND d.status='rejected') OR
     (n.type='document_expiring' AND d.status='approved' AND d.expires_at=(n.data->>'expires_on')::date)));
  END IF;
 END IF;
 IF j.request_id IS NOT NULL THEN
  SELECT * INTO r FROM public.taxi_requests WHERE id=j.request_id;
  valid:=valid AND FOUND;
  IF n.audience='customer' THEN valid:=valid AND r.customer_id=j.recipient_id; END IF;
  IF j.event_type='new_request' THEN
   valid:=valid AND EXISTS(SELECT 1 FROM public.request_push_recipients(j.request_id) WHERE user_id=j.recipient_id);
  ELSIF j.event_type='request_unclaimed' THEN valid:=valid AND r.status='cancelled' AND r.cancel_reason='no_driver';
  ELSE valid:=valid AND r.status::text=j.event_type; END IF;
 END IF;
 IF j.expires_at<=clock_timestamp() OR NOT valid OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=j.recipient_id AND is_active) THEN
  UPDATE private.push_outbox SET status='skipped',last_error='NO_LONGER_ELIGIBLE',lease_token=NULL,lease_until=NULL WHERE id=j.id;
  RETURN NULL;
 END IF;
 UPDATE private.push_outbox SET claimed_at=clock_timestamp() WHERE id=j.id;
 RETURN jsonb_build_object('id',j.id,'recipient_id',j.recipient_id,'payload',j.payload,'expires_at',j.expires_at,'lease_until',j.lease_until);
END $f$;

COMMIT;
