SET LOCAL lock_timeout='3s';
CREATE FUNCTION private.audit_document_validity_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF (NEW.expires_at,NEW.file_url) IS DISTINCT FROM (OLD.expires_at,OLD.file_url) THEN
  INSERT INTO public.audit_log(company_id,actor_id,entity_type,entity_id,action,old_value,new_value)
  VALUES(NEW.company_id,auth.uid(),'document',NEW.id,'document_validity_changed',
   jsonb_build_object('expires_at',OLD.expires_at,'file_url',OLD.file_url),
   jsonb_build_object('expires_at',NEW.expires_at,'file_url',NEW.file_url));
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.audit_document_validity_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER audit_document_validity AFTER UPDATE OF expires_at,file_url ON public.driver_documents
 FOR EACH ROW EXECUTE FUNCTION private.audit_document_validity_change();
