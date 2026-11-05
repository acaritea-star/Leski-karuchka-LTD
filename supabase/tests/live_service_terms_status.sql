-- Synthetic, rollback-only. Old and new legal texts retain separate receipts.
BEGIN;
CREATE FUNCTION pg_temp.live_terms_denied(stmt text) RETURNS void LANGUAGE plpgsql AS $$BEGIN BEGIN EXECUTE stmt;EXCEPTION WHEN OTHERS THEN RETURN;END;RAISE EXCEPTION 'FAIL expected denial: %',stmt;END$$;
DO $test$
DECLARE account uuid:=gen_random_uuid();current_receipt uuid;previous_receipt uuid;digest text;
BEGIN
 SELECT source_digest INTO STRICT digest FROM private.legal_versions WHERE is_current AND terms_version='2026-11-05.1';
 INSERT INTO auth.users(id,email)VALUES(account,'live-terms-'||account||'@example.invalid');
 PERFORM set_config('request.jwt.claims',json_build_object('sub',account,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 current_receipt:=public.accept_legal_versions('2026-11-05.1','2026-11-05.1','continue');
 IF public.accept_legal_versions('2026-11-05.1','2026-11-05.1','continue')<>current_receipt THEN RAISE EXCEPTION 'FAIL duplicate current receipt';END IF;
 -- A cached client may still accept the immediately previous text during the fixed window.
 previous_receipt:=public.accept_legal_versions('2026-10-28-draft.5','2026-10-28.2','continue');
 IF previous_receipt=current_receipt THEN RAISE EXCEPTION 'FAIL previous text became new acceptance';END IF;
 -- Older texts and mismatched pairs are never accepted.
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-27-draft.4'',''2026-10-08.1'',''continue'')');
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-08-draft.3'',''2026-10-08.1'',''continue'')');
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-11-05.1'',''2026-10-28.2'',''continue'')');
 IF NOT EXISTS(SELECT 1 FROM public.legal_acceptances WHERE id=current_receipt AND user_id=account AND source_digest=digest AND terms_version='2026-11-05.1') THEN RAISE EXCEPTION 'FAIL displayed/current text mismatch';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE private.legal_versions SET created_at=now()-interval '8 days' WHERE is_current;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-10-28-draft.5'',''2026-10-28.2'',''continue'')');
 IF public.accept_legal_versions('2026-11-05.1','2026-11-05.1','continue')<>current_receipt THEN RAISE EXCEPTION 'FAIL current receipt changed';END IF;
 PERFORM pg_temp.live_terms_denied('SELECT public.accept_legal_versions(''2026-11-05.1'',''2026-11-05.1'',''advertising'')');
END $test$;
ROLLBACK;
