# Предложение за преглед — НЕ е приложено

Автоматичният преглед отхвърли тази миграция: тя засяга правата на всички таблици в `public`, притежавани от текущия потребител, и подразбиращите се права за бъдещи таблици. Посоченият риск е нарушаване на съществуващи анонимни потоци. Няма промяна в продукционната база и няма файл в `supabase/migrations`, който да я изпълни автоматично.

При проверката на 07.10.2026 всички 25 таблици на приложението са с RLS. Не беше намерена политика, разрешаваща неавтентикирано записване. Наличните общи DML права все пак са излишен втори път за достъп, ако бъдеща политика е грешна. `TRUNCATE` и `REFERENCES` не се ограничават от RLS. Това не означава, че PostgREST предлага HTTP операция TRUNCATE.

Предложението запазва SELECT и приложимите политики за публично четене, както и INSERT/UPDATE/DELETE за вписани потребители. Отнема анонимните права за запис и административните таблични права за вписани потребители. Преди одобрено прилагане трябва да се потвърдят всички публични потоци в отделна тестова среда. Не решава отделния проблем с `spatial_ref_sys`, защото тя е собственост на `supabase_admin`.

Точният отхвърлен SQL:

```sql
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
```

За `spatial_ref_sys` е нужна поддържана намеса от Supabase: отнемане на правата за запис от PUBLIC/anon/authenticated и разрешаване на необходимото четене, със съобразена RLS политика. Наличният postgres акаунт няма собственост или GRANT OPTION. Не е правен опит за смяна на системния собственик или за заобикаляне на правата.

Източници: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
