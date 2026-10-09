# П1-11: поддържано отстраняване на extension-owned права

Проект: `rzjyvxmfqnnxglmgnvma`. Обект: `public.spatial_ref_sys` от PostGIS.

Официално обяснение на находката: [Supabase — RLS Disabled in Public](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public).

Предишната проверка установи клиентски права за запис и собственик `supabase_admin`, които наличната DB роля не може да промени. Не използваме подмяна на собственик, системни таблици или заобикаляне на ограниченията.

Конкретно искане за Supabase support/project administrator: приложете поддържано ограничаване на INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER за `anon` и `authenticated` върху `public.spatial_ref_sys`, като запазите необходимия достъп на PostGIS. Потвърдете дали поддържаното решение е отнемане на правата или преместване на extension в неекспонирана схема. Не премествайте extension без проверка на зависимите географски функции.

Проверка след промяната:

```sql
SELECT c.relowner::regrole AS owner, c.relrowsecurity,
 has_table_privilege('anon','public.spatial_ref_sys','INSERT') AS anon_insert,
 has_table_privilege('authenticated','public.spatial_ref_sys','UPDATE') AS auth_update,
 has_table_privilege('authenticated','public.spatial_ref_sys','DELETE') AS auth_delete,
 has_table_privilege('authenticated','public.spatial_ref_sys','TRUNCATE') AS auth_truncate
FROM pg_class c WHERE c.oid='public.spatial_ref_sys'::regclass;
```

След това: Supabase security advisor, `bulgaria_service_area.sql`, `nearby_cars.sql`, `cash_geo_push.sql` и тест за клиентски достъп. Тази точка остава отворена до действително ограничени права и минали проверки. Този файл е подготвено искане; не е изпратено съобщение до support.
