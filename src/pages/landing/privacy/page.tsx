import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function PrivacyPage() {
  const { t } = useTranslation();

  return (
    <div className="brand-scope min-h-[100dvh] bg-background-50">
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-12 md:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 mb-8 transition-colors">
          <i className="ri-arrow-left-line" aria-hidden="true" />
          {t('back_home')}
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <img src={LOGO_URL} alt="Лески Каручка" className="h-10 w-auto rounded-lg" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground-950 font-heading">
            Политика за поверителност
          </h1>
        </div>

        <div className="bg-white rounded-2xl border border-background-200 p-6 md:p-8 space-y-8 text-sm text-foreground-700 leading-relaxed">
          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">1. Кои сме ние</h2>
            <p>
              „Лески Каручка" ЕООД, ЕИК 205538636, с адрес: гр. Левски, ул. „Васил Левски" 33,
              е администратор на лични данни по смисъла на Регламент (ЕС) 2016/679 (GDPR).
              Тази политика обяснява как събираме, използваме и защитаваме личната ви информация.
            </p>
            <p className="mt-2">
              <strong>Данни за контакт с администратора:</strong>{' '}
              <a href="mailto:info@leski-karuchka.bg" className="text-primary-600 hover:text-primary-700 underline">info@leski-karuchka.bg</a>,
              тел. <a href="tel:+359890005900" className="text-primary-600 hover:text-primary-700 underline">+359 89 000 5900</a>.
              Имаме назначен отговорник по защита на данните (DPO). Можете да се свържете с него на
              същия имейл с тема „DPO".
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">2. Какви данни събираме и защо</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm mt-2 border border-background-200 rounded-lg">
                <thead className="bg-background-100 text-foreground-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Категория данни</th>
                    <th className="px-4 py-3">Цел</th>
                    <th className="px-4 py-3">Правно основание</th>
                    <th className="px-4 py-3">Срок на съхранение</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200">
                  <tr>
                    <td className="px-4 py-3 font-medium">Идентификационни (име, имейл, телефон)</td>
                    <td className="px-4 py-3">Регистрация, сесия, връзка с шофьор.</td>
                    <td className="px-4 py-3">Изпълнение на договор (чл. 6, т. 1, б. „б" GDPR)</td>
                    <td className="px-4 py-3">До изтриване на акаунта + 1 година за данъчни цели.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Локационни (GPS координати)</td>
                    <td className="px-4 py-3">Намиране на най-близък шофьор и изчисляване на маршрут.</td>
                    <td className="px-4 py-3">Изпълнение на договор (чл. 6, т. 1, б. „б" GDPR)</td>
                    <td className="px-4 py-3">Само по време на пътуване; не се съхраняват перманентно.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">История на пътуванията</td>
                    <td className="px-4 py-3">Фактуриране, спорове, подобряване на услугата.</td>
                    <td className="px-4 py-3">Изпълнение на договор / законово задължение (чл. 6, т. 1, б. „б" и „в" GDPR)</td>
                    <td className="px-4 py-3">5 години (счетоводни и данъчни задължения).</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Технически (IP, устройство, браузър)</td>
                    <td className="px-4 py-3">Сигурност, отстраняване на грешки, анонимна аналитика.</td>
                    <td className="px-4 py-3">Легитимен интерес (чл. 6, т. 1, б. „е" GDPR)</td>
                    <td className="px-4 py-3">1 година (логове); IP-та се анонимизират за аналитика.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Плащания (метод, последни 4 цифри)</td>
                    <td className="px-4 py-3">Обработка на плащания и счетоводство.</td>
                    <td className="px-4 py-3">Изпълнение на договор / законово задължение</td>
                    <td className="px-4 py-3">5 години (данъчни изисквания).</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">3. Автоматизирано вземане на решения и профилиране</h2>
            <p>
              Не използваме автоматизирано вземане на решения с правни последици за вас.
              Ценообразуването е алгоритмично (разстояние + време), но винаги с човешка проверка
              от страна на шофьора/диспечера и с възможност за ръчна корекция.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">4. Съхранение и защита</h2>
            <p>
              Данните се съхраняват на сървъри в Европейския съюз чрез SaaS Supabase.
              Използваме криптирани връзки (TLS 1.3), хеширани пароли (bcrypt) и
              Row Level Security (RLS) за изолация на данните между компании и потребители.
              Достъп до лични данни има само упълномощен персонал под строг контрол.
              Провеждаме редовни одити за сигурност и обучение на служителите.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">5. Споделяне с трети лица</h2>
            <p>
              Споделяме данни само с:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Съответната компания за каручки, чийто шофьор изпълнява поръчката.</li>
              <li>Платежни доставчици (Stripe, PayPal) — само за обработка на транзакции.</li>
              <li>Google Maps / Geocoding — само адреси (без име/телефон) за маршрутизация.</li>
              <li>Държавни органи — само при законово изискване.</li>
            </ul>
            <p className="mt-2">
              Не продаваме лични данни. Не споделяме данни за маркетингови цели без изрично съгласие.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">6. Права на субектите на данни (GDPR)</h2>
            <p>
              Съгласно GDPR имате следните права:
            </p>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li><strong>Достъп</strong> — искате копие от личните ви данни, които обработваме.</li>
              <li><strong>Коригиране</strong> — искате поправка на неточни или непълни данни.</li>
              <li><strong>Изтриване („правото да бъдеш забравен")</strong> — искате изтриване на данните, когато няма законово основание за съхранението им.</li>
              <li><strong>Ограничаване</strong> — искате временно спиране на обработката.</li>
              <li><strong>Преносимост</strong> — получавате данните си в машинно четим формат (JSON/CSV).</li>
              <li><strong>Възражение</strong> — възразявате срещу обработка на база легитимен интерес или директен маркетинг.</li>
              <li><strong>Жалба</strong> — право на жалба до Комисията за защита на личните данни (КЗЛД), България.</li>
            </ul>
            <p className="mt-2">
              Заявки за упражняване на права:{' '}
              <a href="mailto:info@leski-karuchka.bg" className="text-primary-600 hover:text-primary-700 underline">info@leski-karuchka.bg</a>.
              Ще отговорим в рамките на <strong>30 дни</strong>. При сложни заявки срокът може да бъде удължен с още 2 месеца,
              за което ще бъдете уведомени.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">7. Бисквитки и онлайн проследяване</h2>
            <p>
              Използваме бисквитки само след вашето изрично съгласие (освен задължителните).
              Категориите са: задължителни, функционални, аналитични и маркетингови.
              Можете да управлявате съгласието си по всяко време чрез банера за бисквитки
              или като изтриете записа <code className="bg-background-100 px-1 rounded text-xs">lk_cookie_consent_v2</code> от
              localStorage на вашия браузър и рефрешнете страницата.
            </p>
            <p className="mt-2">
              За подробности вижте{' '}
              <Link to="/cookies" className="text-primary-600 hover:text-primary-700 underline">Политиката за бисквитки</Link>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">8. Предаване на данни извън ЕС/ЕИП</h2>
            <p>
              В момента данните се съхраняват само на сървъри в ЕС (Supabase — Франкфурт, Германия).
              Ако в бъдеще използваме доставчици извън ЕС, ще прилагаме стандартни договорни клаузи (SCC)
              и ще ви уведомим преди това.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">9. Промени в политиката</h2>
            <p>
              Можем да актуализираме тази политика при промяна в законодателството или услугите.
              Промените се публикуват на тази страница с нова дата на влизане в сила.
              За съществени промени ще ви уведомим по имейл или чрез известие в приложението.
            </p>
          </section>

          <p className="text-xs text-foreground-400 pt-4 border-t border-background-200">
            Последна актуализация: 13 август 2026 г. · Контакт:{' '}
            <a href="mailto:info@leski-karuchka.bg" className="underline">info@leski-karuchka.bg</a>
          </p>
        </div>
      </div>
    </div>
  );
}