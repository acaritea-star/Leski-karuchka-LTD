-- Remove the obsolete launch-status sentence without rewriting prior consent.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
UPDATE private.legal_versions SET is_current=false WHERE is_current;
INSERT INTO private.legal_versions(terms_version,privacy_version,source_digest)
VALUES('2026-10-27-draft.4','2026-10-08.1','09b66e5e78ac2d72b14c1c96248286a7ad4b8126718d437775e751e3a675d7e7');
CREATE OR REPLACE FUNCTION private.accept_legal_versions(p_terms text,p_privacy text,p_method text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $legal$
DECLARE result uuid; digest text; uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=uid AND is_active) THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_method IS NULL OR p_method NOT IN ('google','facebook','continue') THEN RAISE EXCEPTION 'Invalid acceptance method'; END IF;
 SELECT v.source_digest INTO digest FROM private.legal_versions v
 WHERE v.terms_version=p_terms AND v.privacy_version=p_privacy AND (v.is_current OR (
  -- An open PWA may accept only its own previous text for seven days.
  -- This receipt never counts as acceptance of the newly published version.
  v.terms_version='2026-10-08-draft.3' AND v.privacy_version='2026-10-08.1'
  AND EXISTS(SELECT 1 FROM private.legal_versions current_version WHERE current_version.is_current
   AND current_version.terms_version='2026-10-27-draft.4' AND current_version.privacy_version='2026-10-08.1'
   AND current_version.created_at>clock_timestamp()-interval '7 days')
 ));
 IF NOT FOUND THEN RAISE EXCEPTION 'Legal versions changed. Refresh the app.'; END IF;
 INSERT INTO public.legal_acceptances(user_id,terms_version,privacy_version,source_digest,method)
 VALUES(uid,p_terms,p_privacy,digest,p_method) ON CONFLICT(user_id,terms_version,privacy_version) DO NOTHING;
 SELECT id INTO result FROM public.legal_acceptances WHERE user_id=uid AND terms_version=p_terms AND privacy_version=p_privacy;
 RETURN result;
END $legal$;
NOTIFY pgrst,'reload schema';
COMMIT;
