SET LOCAL lock_timeout='3s';
DO $restore_test$
DECLARE original jsonb; restored jsonb;
BEGIN
 SELECT (SELECT jsonb_agg(row_value ORDER BY row_value::text) FROM (
 SELECT jsonb_build_object('table',c.relname,'grantor',x.grantor,'grantee',x.grantee,'privilege',x.privilege_type,'grantable',x.is_grantable) row_value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 UNION ALL
 SELECT jsonb_build_object('default',d.defaclnamespace,'owner',d.defaclrole,'type',d.defaclobjtype,'grantor',x.grantor,'grantee',x.grantee,'privilege',x.privilege_type,'grantable',x.is_grantable)
 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres')
) a) INTO original;
 BEGIN
 -- Defense in depth: RLS does not cover TRUNCATE/REFERENCES.
-- Keep SELECT grants (public news and other read policies) and authenticated DML.
-- Extension-owned PostGIS objects require Supabase owner-level remediation.
DO $grants$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT n.nspname, c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e')
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM PUBLIC, anon', obj.nspname, obj.relname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM authenticated', obj.nspname, obj.relname);
  END LOOP;
END $grants$;
-- Defaults for new application tables created by future postgres migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
 REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM authenticated;
NOTIFY pgrst, 'reload schema';
 -- Exact restoration of privileges removed by the approved package.
-- Snapshot: 2026-10-07T15:46:06.913178+00:00
-- Does not revert application rows, schemas, or grants made later to other objects.
SET LOCAL lock_timeout='3s';
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."request_declines" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."request_declines" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."news_articles" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."news_articles" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."profiles" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."profiles" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."vehicle_types" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."vehicle_types" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."vehicles" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."vehicles" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."ratings" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."ratings" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."driver_locations" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."driver_locations" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."notifications" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."notifications" TO "authenticated";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."trips" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."trips" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."payment_transactions" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."payment_transactions" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."saved_places" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."saved_places" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."coupons" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."coupons" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."drivers" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."drivers" TO "authenticated";
GRANT UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."taxi_requests" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."taxi_requests" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."audit_log" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."audit_log" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."ledger" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."ledger" TO "authenticated";
GRANT DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."push_subscriptions" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."driver_documents" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."driver_documents" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."app_config" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."app_config" TO "authenticated";
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."companies" TO "anon";
GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE "public"."companies" TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO "authenticated";
NOTIFY pgrst, 'reload schema';

 SELECT (SELECT jsonb_agg(row_value ORDER BY row_value::text) FROM (
 SELECT jsonb_build_object('table',c.relname,'grantor',x.grantor,'grantee',x.grantee,'privilege',x.privilege_type,'grantable',x.is_grantable) row_value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 UNION ALL
 SELECT jsonb_build_object('default',d.defaclnamespace,'owner',d.defaclrole,'type',d.defaclobjtype,'grantor',x.grantor,'grantee',x.grantee,'privilege',x.privilege_type,'grantable',x.is_grantable)
 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) x WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres')
) a) INTO restored;
 IF original IS DISTINCT FROM restored THEN RAISE EXCEPTION 'Restore script does not reproduce original grants'; END IF;
 RAISE EXCEPTION USING ERRCODE='PZ003',MESSAGE='restore_test_success_rollback';
 EXCEPTION WHEN SQLSTATE 'PZ003' THEN NULL;
 END;
END $restore_test$;
