-- Run only after BOTH push Edge Functions use read_push_vapid_keys.
-- Caller supplies a transaction. No key values are returned or rotated.
DO $cutover$
DECLARE old_public text; old_private text; stored_public text; stored_private text;
BEGIN
 SELECT vapid_public_key,vapid_private_key INTO old_public,old_private FROM public.app_config WHERE id=1 FOR UPDATE;
 SELECT decrypted_secret INTO stored_public FROM vault.decrypted_secrets WHERE name='leski_vapid_public_key';
 SELECT decrypted_secret INTO stored_private FROM vault.decrypted_secrets WHERE name='leski_vapid_private_key';
 IF old_private IS NULL AND old_public=stored_public AND coalesce(stored_private,'')<>'' THEN RETURN; END IF;
 IF coalesce(old_public,'')='' OR coalesce(old_private,'')='' THEN RAISE EXCEPTION 'Existing VAPID pair required'; END IF;
 IF (stored_public IS NOT NULL AND stored_public<>old_public) OR (stored_private IS NOT NULL AND stored_private<>old_private) THEN
  RAISE EXCEPTION 'Vault contains a different VAPID pair';
 END IF;
 IF stored_public IS NULL THEN PERFORM vault.create_secret(old_public,'leski_vapid_public_key','Stable Web Push public key'); END IF;
 IF stored_private IS NULL THEN PERFORM vault.create_secret(old_private,'leski_vapid_private_key','Stable Web Push private key'); END IF;
 UPDATE public.app_config SET vapid_private_key=NULL,updated_at=clock_timestamp() WHERE id=1;
END $cutover$;
