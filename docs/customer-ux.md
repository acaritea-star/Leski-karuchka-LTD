# Клиентски екран — септември 2026

След вход клиентът преминава през „Откъде тръгваш?“ → „Накъде отиваш?“ → „Готови за път.“ в един долен панел. При нормален мобилен размер височината е около една трета от видимата страница. На малък екран и при отворена клавиатура съдържанието се скролва вътре в панела; основният бутон остава отделен от скрола. Плащането е само в брой.

## Променени файлове

| Файл | Промяна |
| --- | --- |
| `src/pages/customer/home/page.tsx` | Три стъпки; възстановяване на активна поръчка преди нова; защита от закъснял GPS и стара цена; премахнати прекъсващите начални модали. |
| `src/pages/customer/components/CustomerLayout.tsx` | Общ екран с карта, плаващ хедър и компактен панел. |
| `src/pages/customer/components/customer.css` | Зелената палитра, компактни контроли, преходи, скелетони, безопасни отстояния и reduced motion. |
| `src/hooks/useCustomerViewport.ts` | Следене на видимата област при мобилна клавиатура; запазен pinch-to-zoom. |
| `src/pages/customer/components/BookingSteps.tsx` | Заглавия и навигация между трите стъпки. |
| `src/pages/customer/components/bookingFlow.ts` | Избор на следваща стъпка и проверка на запазените адреси. |
| `src/pages/customer/components/BookingCard.tsx` | Потвърждение, редакция на адресите, тип автомобил, цена и един основен бутон. |
| `src/pages/customer/components/LocationPicker.tsx` | Търсене в панела; игнориране на стари отговори; грешка с повторен опит; без автоматично отваряне на клавиатурата. |
| `src/lib/places.ts` | Неуспешна мрежова заявка се показва като грешка, а не като липса на адреси. |
| `src/pages/customer/components/BookingMap.tsx` | Показва маршрута от ценовата оферта без второ извикване на Routes; зареждане и повторен опит. |
| `src/pages/customer/components/RequestStatusCard.tsx` | Компактно търсене на шофьор, крайни състояния и потвърждение за отказ в същия панел. |
| `src/pages/customer/components/DriverTracking.tsx` | Проследяване със същия изглед, четима информация за шофьора, отказ в панела; правилните Google Maps методи за границите на картата. |
| `src/pages/customer/components/AppMenu.tsx` | Меню в native modal dialog над картата; клавиатурен фокус и Escape. |
| `src/components/feature/NotificationBell.tsx` | Достъпен етикет и ширина за малки екрани. |
| `src/google-maps-types.d.ts` | Коректни типове за padding и географските граници на Google Maps. |
| `src/i18n/local/bg/common.ts`, `src/i18n/local/en/common.ts` | Текстове на двата езика. |
| `package.json`, `package-lock.json` | Само инструменти за тестове: Testing Library и jsdom; без нова библиотека в приложението. |
| `src/pages/customer/home/page.test.tsx` | Проверки на трите стъпки, кеш RPC, двойно натискане, промяна/изтичане на оферта, offline и възстановяване. |
| `src/pages/customer/components/LocationPicker.test.tsx` | Закъснели отговори, напускане на стъпката, повторен опит и GPS само за началния адрес. |
| `src/pages/customer/components/BookingMap.test.tsx` | Карта само с потвърдения маршрут; премахване на стар маршрут; повторно зареждане. |
| `src/pages/customer/components/bookingFlow.test.ts` | Редактиране без повторение на готови стъпки; невалидна история. |
| `src/hooks/useCustomerViewport.test.tsx` | Свиване на видимата област и pinch-to-zoom. |
| `tests/booking-preview.html`, `tests/booking-screen.html`, `tests/booking-screen.tsx` | Локален интерфейсен стенд с примерни данни; не влиза в production build и не прави реални поръчки. |

## Проверка и публикуване

`npm ci` → `npm run check` изпълнява ESLint, Vitest, TypeScript и production build.

Локално: `npm run dev` → `/tests/booking-preview.html`. Избор на 390×780, 320×568, намален прозорец и desktop. Това е стенд с примерни адреси/цена и фон вместо Google Maps, не доказателство за реална поръчка.

Облачният браузър в средата блокира локалния адрес и file URL, затова визуален преглед в браузър и тест на истинска iOS клавиатура не са потвърдени. След Readdy Pull → Publish провери трите стъпки, менюто и клавиатурата в Safari. Реалният маршрут, оферта, приемане и GPS изискват работещите текущи Google/Supabase настройки и клиент/шофьор.

Няма миграции, промени по RLS, плащания или Edge Functions в тази версия. Поръчката продължава да използва съществуващия `create_taxi_request` RPC и валидна сървърна оферта.
