-- Deploy this reader before both push Edge Functions, then run the separate
-- Vault cutover. Existing subscribers keep the exact original pair.
CREATE FUNCTION private.read_push_vapid_keys() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
DECLARE public_key text; private_key text;
BEGIN
 SELECT decrypted_secret INTO public_key FROM vault.decrypted_secrets WHERE name='leski_vapid_public_key';
 SELECT decrypted_secret INTO private_key FROM vault.decrypted_secrets WHERE name='leski_vapid_private_key';
 IF public_key IS NULL AND private_key IS NULL THEN
  SELECT vapid_public_key,vapid_private_key INTO public_key,private_key FROM public.app_config WHERE id=1;
 END IF;
 IF coalesce(public_key,'')='' OR coalesce(private_key,'')='' THEN
  RAISE EXCEPTION 'Push configuration unavailable' USING ERRCODE='55000';
 END IF;
 RETURN jsonb_build_object('publicKey',public_key,'privateKey',private_key);
END $body$;
CREATE FUNCTION public.read_push_vapid_keys() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.read_push_vapid_keys() $$;
REVOKE ALL ON FUNCTION private.read_push_vapid_keys(),public.read_push_vapid_keys() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.read_push_vapid_keys(),public.read_push_vapid_keys() TO service_role;
