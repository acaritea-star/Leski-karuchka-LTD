-- Synthetic, rollback-only. Old and new legal texts retain separate receipts.
BEGIN;
CREATE FUNCTION pg_temp.live_terms_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $test$
DECLARE account uuid:=gen_random_uuid();current_receipt uuid;old_receipt uuid;grandparent_receipt uuid;digest text;
BEGIN
 SELECT source_digest INTO STRICT digest FROM private.legal_versions WHERE is_current AND terms_version='2026-10-28-draft.5';
 INSERT INTO auth.users(id,email)VALUES(account,'live-terms-'||account||'@example.invalid');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',account,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 current_receipt:=public.accept_legal_versions('2026-10-28-draft.5','2026-10-28.2','continue');
 IF public.accept_legal_versions('2026-10-28-draft.5','2026-10-28.2','continue')<>current_receipt THEN RAISE EXCEPTION 'FAIL duplicate current receipt';END IF;
 old_receipt:=public.accept_legal_versions('2026-10-27-draft.4','2026-10-08.1','continue');
 IF old_receipt=current_receipt THEN RAISE EXCEPTION 'FAIL old text became new acceptance';END IF;
 grandparent_receipt:=public.accept_legal_versions('2026-10-08-draft.3','2026-10-08.1','continue');
 IF grandparent_receipt IN(current_receipt,old_receipt) THEN RAISE EXCEPTION 'FAIL original cached receipt relabelled';END IF;
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-28-draft.5'',''2026-10-08.1'',''continue'')');
 IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE id=current_receipt AND user_id=account AND source_digest=digest AND terms_version='2026-10-28-draft.5') THEN RAISE EXCEPTION 'FAIL displayed/current text mismatch';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE private.legal_versions SET created_at=now()-interval '8 days' WHERE terms_version='2026-10-27-draft.4';
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-08-draft.3'',''2026-10-08.1'',''continue'')');
 IF public.accept_legal_versions('2026-10-27-draft.4','2026-10-08.1','continue')<>old_receipt THEN RAISE EXCEPTION 'FAIL predecessor window changed';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE private.legal_versions SET created_at=now()-interval '8 days' WHERE is_current;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-27-draft.4'',''2026-10-08.1'',''continue'')');
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-28-draft.5'',''2026-10-28.2'',''advertising'')');
END $test$;
ROLLBACK;
