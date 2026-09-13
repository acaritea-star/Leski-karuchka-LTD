# LeskiKaruchka — точен отчет за промените

Дата: 13.09.2026. Сравнение с оригиналния `project-13700706.zip`.

Трите SQL миграции и петте променени Edge Functions са внедрени в Supabase. Преработеният сайт е компилиран и включен в архива; не е публикуван на домейна.

Променени съществуващи файлове: **39**. Нови файлове с код, конфигурация и документация: **22**. Изтрити оригинални файлове: **0**. Отделно е добавен генерираният `out/`.

Проверки: чиста инсталация, TypeScript, **23/23 теста**, lint и production build преминаха. SQL проверките преминаха в транзакция с ROLLBACK. Подробности и ограничения: `VERIFICATION.md`.

**Преди реално пускане:** Supabase API връща `JWT issued at future` след успешен Auth вход; няма въведен автомобил за наличния шофьор. Нужно е отстраняване на API проблема, реален автомобил, публикуване на сайта и финалното `deployment/quote-cutover.sql`. Не се отчита като готова национална enterprise услуга.

## Файлове

| Файл | Статус | Какво е променено |
| --- | --- | --- |
| `.env.example` | Нов | Образец само с публични клиентски настройки и празен optional DSN. |
| `.gitignore` | Нов | Изключва инсталирани пакети, build, локална конфигурация и временни CLI данни. |
| `CHANGES.md` | Нов | Този отчет, генериран чрез сравнение с предоставения оригинален ZIP. |
| `README.md` | Нов | Стартиране, проверки, структура на пакета и действителен статус на пускането. |
| `VERIFICATION.md` | Нов | Резултати от проверки и непотвърдени сценарии; точна диагностика на API грешката. |
| `auto-imports.d.ts` | Нов | Генерирани от Vite декларации за използвания auto-import plugin. |
| `deployment/README.md` | Нов | Ред за публикуване, cutover, типове, SQL тестове и ограничения при възстановяване. |
| `deployment/file-manifest.json` | Нов | Всеки променен/нов файл с SHA-256; включва генерирания build. |
| `deployment/quote-cutover.sql` | Нов | Подготвено спиране на старите browser INSERT-и след публикуване; още не е изпълнено. |
| `eslint.config.ts` | Променен | Разрешава конкретните context hook exports за Fast Refresh; запазва lint проверката. |
| `package-lock.json` | Нов | Нов възпроизводим lockfile за npm ci; не е присъствал в оригиналния ZIP. |
| `package.json` | Променен | Фиксира проверените версии, добавя test/check и type-check преди build; премахва неизползвани Firebase, Stripe и Lucide пакети. |
| `project_plan.md` | Променен | Заменя стария план с действителен статус, критерии за пилот, надеждност и разрастване; официални източници. |
| `public/sw.js` | Променен | Премахва шумни debug log съобщения от service worker. |
| `scripts/types-from-schema.py` | Нов | Малък възпроизводим резервен генератор на типове от действителния SQL snapshot. |
| `src/App.tsx` | Променен | Добавя общия GPS provider и обработка на неочаквана грешка в приложението. |
| `src/components/feature/AuthGuard.tsx` | Променен | Показва възстановим екран при сесия без достъпен профил вместо празна страница. |
| `src/components/feature/DriverGpsProvider.tsx` | Нов | Един GPS процес през всички шофьорски маршрути, състояние от базата, следене на свежест и Wake Lock. |
| `src/components/feature/EnableNotificationsBanner.tsx` | Променен | Премахва излишни debug log съобщения. |
| `src/components/feature/ErrorBoundary.tsx` | Нов | Показва разбираема грешка и повторно зареждане при срив на React интерфейса. |
| `src/contexts/AuthContext.tsx` | Променен | Зарежда реалния profiles ред; пази от състезание между сесии, изчиства кеш/GPS при смяна на потребител и изчаква профила; timeout и коректно изчистване на лични полета. |
| `src/hooks/usePushNotifications.ts` | Променен | Премахва debug логове; запазва работа със съществуващите VAPID ключове. |
| `src/i18n/local/bg/common.ts` | Променен | Премахва дублирания ключ vehicle_type, който пречеше на type-check. |
| `src/i18n/local/en/common.ts` | Променен | Премахва дублирания ключ vehicle_type, който пречеше на type-check. |
| `src/lib/database.types.ts` | Променен | Типове на реални таблици, изгледи, enum стойности, връзки и използвания create_taxi_request RPC; включва position_at и ride_quotes. |
| `src/lib/driverLocation.test.ts` | Нов | 10 теста за GPS жизнен цикъл, честота, stale данни, потвърждение и cleanup. |
| `src/lib/driverLocation.ts` | Променен | Един uploader, ново измерване при heartbeat, максимум един запис едновременно, проверка на DB грешки и потвърден timestamp; обща online/offline операция. |
| `src/lib/googleMaps.ts` | Променен | Типизира данните за ценова оферта в отговора от Google route функцията. |
| `src/lib/news.ts` | Променен | Проверява допустимия статус на статия чрез общ helper. |
| `src/lib/places.ts` | Променен | Коректни типове на Places резултатите и премахнати debug логове. |
| `src/lib/pricing.test.ts` | Променен | Допълва проверките за реалния Comfort множител и невалидни числа; тества общата формула. |
| `src/lib/pricing.ts` | Променен | Преекспортира общата функция за цена; премахва втора независима реализация. |
| `src/lib/push.ts` | Променен | Премахва излишни debug логове при push извикване. |
| `src/pages/admin/analytics/page.tsx` | Променен | Чете profiles вместо несъществуващата public.users. |
| `src/pages/admin/components/AdminCompanyContext.tsx` | Променен | Правилна обработка на липсваща company_id и зависимости на effect. |
| `src/pages/admin/map/page.tsx` | Променен | Не показва стар GPS като онлайн позиция. |
| `src/pages/admin/news/edit/page.tsx` | Променен | Използва реалните Insert типове и валидиран статус на статията. |
| `src/pages/admin/news/page.tsx` | Променен | Общ валидиран статус вместо несъвместим свободен string. |
| `src/pages/admin/vehicles/page.tsx` | Променен | Стабилизира vehicleTypes с useMemo за правилни hook зависимости. |
| `src/pages/auth/callback/page.tsx` | Променен | Опростява OAuth callback; профилът се създава от DB trigger и се зарежда чрез общия auth context. |
| `src/pages/customer/components/BookingCard.tsx` | Променен | Категории от базата, готовност на сървърната оферта и само наличния начин за плащане в брой. |
| `src/pages/customer/components/DriverTracking.tsx` | Променен | Използва действителния updated_at, не освежава стар timestamp при polling; обработва отказана от сървъра отмяна. |
| `src/pages/customer/home/page.tsx` | Променен | Премахва твърдо записани категории/множители и fallback цена; получава оферта от сървъра и поръчва чрез RPC; защита от повторно натискане и изтичане на офертата. |
| `src/pages/driver/home/page.tsx` | Променен | Премахва дублирано GPS изпращане, използва общия provider и online операция; показва грешка при първо включване. |
| `src/pages/driver/profile/page.tsx` | Променен | Поправя автомобилните полета към реалните registration_number и capacity. |
| `src/pages/driver/requests/page.tsx` | Променен | Обща online операция и GPS състояние; промяната на курс изисква очакван предходен статус и потвърден ред. |
| `src/pages/home/page.tsx` | Променен | Опростява пренасочването по роля; премахва изкуствените таймери и показва проблем с профила. |
| `supabase/functions/_shared/auth.ts` | Нов | Проверка на сесия, активен профил, API лимит, координати и общи HTTP отговори; 503 при недостъпна profile услуга. |
| `supabase/functions/_shared/pricing.ts` | Нов | Един източник за тарифната формула, множители, закръгляване и валидни числови входове. |
| `supabase/functions/expire-stale-requests/index.ts` | Променен | Малък защитен compatibility endpoint; основната поддръжка е един SQL cron. |
| `supabase/functions/generate-vapid-keys/index.ts` | Променен | Изисква удостоверен активен акаунт; запазва наличните VAPID ключове. |
| `supabase/functions/google-geocode/index.ts` | Променен | Изисква удостоверяване и API лимит; ограничено време за Google заявка. |
| `supabase/functions/google-routes/index.ts` | Променен | Проверява координати/роля, получава Google маршрут и записва двуминутна оферта с реалната тарифа и категория. |
| `supabase/functions/send-push-notification/index.ts` | Променен | Проверява право към конкретен курс/получател; ограничава endpoints и време за външна заявка. |
| `supabase/migrations/20260913120515_enterprise_core.sql` | Нов | Внедрена: роли, GPS guard, уникален активен курс, преходи на статуса, истинска trip история, оферти/RPC, права и един cron. |
| `supabase/migrations/20260913120915_api_rate_limit.sql` | Нов | Внедрена: private брояч и service-only RPC за ограничаване на честотата на API. |
| `supabase/migrations/20260913121928_legacy_insert_guard.sql` | Нов | Внедрена: временна защита на стария INSERT до публикуване на новия сайт; пресмята тарифата от базата. |
| `supabase/schema-catalog.json` | Нов | Снимка на реалната структура без клиентски данни, използвана за генериране на типове. |
| `supabase/tests/core.sql` | Нов | SQL проверки с временни акаунти/данни, роли и забранени операции; изисква transaction wrapper. |
| `supabase/tests/run.sql` | Нов | Безопасен psql wrapper: BEGIN, тестове, ROLLBACK и спиране при грешка. |
| `vite.config.ts` | Променен | Коректен ESM път за alias и production build без source maps. |

## Генериран сайт

`out/` съдържа готовия HTML, CSS, JavaScript и публични ресурси. Всеки генериран файл е изрично изброен в `deployment/file-manifest.json`, със SHA-256. `node_modules`, локалната git история и временни тестови идентификационни данни не са включени. Публичната конфигурация от оригиналния архив е запазена.

## Граници на тази актуализация

Няма доказан пълен HTTP курс заради API грешката. Няма нова интеграция за плащане с карта, фонов GPS при заключен телефон, гарантирана push доставка, натоварващ тест или проверен restore. Старият INSERT е оставен временно за съвместимост; окончателното му изключване следва публикуването. Оставащите security advisories и ограниченията на проверките са описани във VERIFICATION.md.
