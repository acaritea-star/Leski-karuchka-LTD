-- Emergency compatibility rollback. Keep all invitations, companies, profiles,
-- verified drivers and tariffs. Apply only together with reverting the frontend.
-- The old open candidacy API becomes available again when the INSERT guard is removed.
BEGIN;
SET LOCAL lock_timeout='5s';
DROP TRIGGER IF EXISTS guard_invited_driver_application ON public.driver_applications;
DROP TRIGGER IF EXISTS guard_company_setup ON public.companies;
REVOKE EXECUTE ON FUNCTION public.create_partner_invitation(uuid,text,text,uuid),private.create_partner_invitation(uuid,text,text,uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_partner_invitation_email(uuid,uuid,boolean),private.claim_partner_invitation_email(uuid,uuid,boolean) FROM service_role;
-- Do not delete new columns, accepted memberships or invitation evidence.
COMMIT;
