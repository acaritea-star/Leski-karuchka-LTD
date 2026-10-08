-- Emergency rollback only: restores the two policies as they were before 20261008094300.
-- This reopens reads by deactivated administrators with a retained session.
BEGIN;
SET LOCAL lock_timeout='3s';
ALTER POLICY audit_log_select_admin ON public.audit_log USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(select auth.uid()) AND (p.role='SUPER_ADMIN' OR (p.role='COMPANY_ADMIN' AND p.company_id=audit_log.company_id))));
ALTER POLICY ledger_select_admin ON public.ledger USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(select auth.uid()) AND (p.role='SUPER_ADMIN' OR (p.role='COMPANY_ADMIN' AND p.company_id=ledger.company_id))));
NOTIFY pgrst,'reload schema';
COMMIT;
