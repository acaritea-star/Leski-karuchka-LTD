-- Restore legacy readers BEFORE reverting either Edge Function. Keep Vault.
DO $rollback$
DECLARE pub text; priv text;
BEGIN
 SELECT decrypted_secret INTO pub FROM vault.decrypted_secrets WHERE name='leski_vapid_public_key';
 SELECT decrypted_secret INTO priv FROM vault.decrypted_secrets WHERE name='leski_vapid_private_key';
 IF coalesce(pub,'')='' OR coalesce(priv,'')='' THEN RAISE EXCEPTION 'Vault pair required for rollback'; END IF;
 IF EXISTS(SELECT 1 FROM public.app_config WHERE id=1 AND vapid_public_key IS DISTINCT FROM pub) THEN
  RAISE EXCEPTION 'Refuse to replace a different public key';
 END IF;
 UPDATE public.app_config SET vapid_private_key=priv,updated_at=clock_timestamp() WHERE id=1;
END $rollback$;
