-- Publish accurate payment/privacy text; preserve each previous receipt and cutover window.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
UPDATE private.legal_versions SET is_current=false WHERE is_current;
INSERT INTO private.legal_versions(terms_version,privacy_version,source_digest)
VALUES('2026-10-28-draft.5','2026-10-28.2','91a0a40b87b50091ee28ef1b0a595b4901a59261f9f09691c910044c2bf2a26f');
CREATE OR REPLACE FUNCTION private.accept_legal_versions(p_terms text,p_privacy text,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legal$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT v.source_digest INTO digest FROM private.legal_versions v
 WHERE v.terms_version=p_terms AND v.privacy_version=p_privacy AND (v.is_current OR EXISTS(
  SELECT 1 FROM private.legal_versions current_version WHERE current_version.is_current
   AND current_version.terms_version='2026-10-28-draft.5' AND current_version.privacy_version='2026-10-28.2'
   AND ((v.terms_version='2026-10-27-draft.4' AND v.privacy_version='2026-10-08.1'
     AND current_version.created_at>clock_timestamp()-interval '7 days')
    OR (v.terms_version='2026-10-08-draft.3' AND v.privacy_version='2026-10-08.1'
     -- Keep the original retirement deadline. Republishing never extends it.
     AND EXISTS(SELECT 1 FROM private.legal_versions previous_version
       WHERE previous_version.terms_version='2026-10-27-draft.4' AND previous_version.privacy_version='2026-10-08.1'
       AND previous_version.created_at>clock_timestamp()-interval '7 days')))
 ));
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
END $legal$;
NOTIFY pgrst,'reload schema';
COMMIT;
