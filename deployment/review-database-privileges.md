# Одобрен пакет за права — приложен на 07.10.2026

Пакетът е приложен след изричното одобрение на потребителя. Първоначалният автоматичен отказ и неговата причина са документирани в предходната версия на този файл. Не е заобикалян отказът; прилагането е след новото одобрение.

## Обхват

26 таблици на приложението, притежавани от postgres в public; без extension-owned обекти. SELECT и приложимите политики остават. Отнети са анонимните INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER и authenticated TRUNCATE/REFERENCES/TRIGGER. Същите ограничения важат за бъдещите postgres таблици в public. Няма изтрити профили, курсове или отчети. Други права, включително MAINTAIN, не са част от този точен пакет.

## Предварителни проверки и връщане

- Точен snapshot: [database-privileges-before-2026-10-07.json](database-privileges-before-2026-10-07.json).
- Подготвен и проверен скрипт: [restore-database-privileges-2026-10-07.sql](restore-database-privileges-2026-10-07.sql). Възстановява отнетите права, включително първоначалните grant options, за заснетите обекти. Не променя данните и не заличава последващи несвързани права.
- Нямаше свързана отделна тестова база/branch. Предварителните проверки бяха изолирани под-транзакции с rollback в същия проект. Тестовете за шофьори, курсове и отчетност се изпълняват със синтетични данни и собствени роли; всяка група се връща отделно. Първото общо изпълнение на фикстурите се отказа и бе върнато изцяло; отделянето им запази самостоятелния rollback договор на тестовете.
- Проверени са ограниченията за съществуващи и бъдещи таблици, както и точното възстановяване на предишния набор от права. При SQL грешка цялата миграция се отменя.
- След прилагането трите SQL регресии минаха отново. Потвърдено е, че не остават тестови фирми или потребители.

Миграции: `20261007155125` — предварителни проверки с rollback; `20261007155222` — проверка на възстановяването с rollback; `20261007155242` — реално прилагане.

## Отделен оставащ системен въпрос

PostGIS `spatial_ref_sys`, `geometry_columns` и `geography_columns` са извън пакета. За системната таблица `spatial_ref_sys` остава съобщението за RLS и права за запис; наличният postgres акаунт няма необходимата собственост/GRANT OPTION. Нужна е намеса от Supabase. Правата върху metadata views не доказват, че те поддържат съответните операции. Не е променян системният собственик.

SQL на одобрения пакет:

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

Източници: [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Supabase RLS advisor](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).
