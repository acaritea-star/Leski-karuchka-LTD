import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function TermsPage() {
  const { t } = useTranslation();

  return (
    <div className="brand-scope min-h-[100dvh] bg-background-50">
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-12 md:py-16">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 mb-8 transition-colors">
          <i className="ri-arrow-left-line" />
          {t('back_home')}
        </Link>

        <div className="flex items-center gap-3 mb-8">
          <img src={LOGO_URL} alt="Лески Каручка" className="h-10 w-auto rounded-lg" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground-950 font-heading">
            Общи условия
          </h1>
        </div>

        <div className="bg-white rounded-2xl border border-background-200 p-6 md:p-8 space-y-8 text-sm text-foreground-700 leading-relaxed">
          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">1. Общи разпоредби</h2>
            <p>
              Настоящите Общи условия уреждат отношенията между „Лески Каручка" ЕООД,
              наричано по-долу „Платформата", и потребителите на мобилното и уеб
              приложение за поръчка на услуги с каручка.
            </p>
            <p className="mt-2">
              С използването на Платформата всеки потребител декларира, че е запознат
              с настоящите Общи условия, разбира ги и ги приема безусловно.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">2. Услуги</h2>
            <p>
              Платформата осигурява цифрова посредническа услуга, чрез която клиенти
              могат да изпращат заявки за превози с каручка към регистрирани
              компании за каручки и шофьори. Платформата не извършва превозни услуги
              директно — тя свързва търсенето с предлагането.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">3. Регистрация и акаунти</h2>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Регистрацията изисква валиден имейл адрес и телефонен номер.</li>
              <li>Всеки потребител носи отговорност за верността на данните си.</li>
              <li>Забранено е създаването на фалшиви акаунти или имитация на друго лице.</li>
              <li>Акаунти с фалшиви данни могат да бъдат изтрити без предизвестие.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">4. Права и задължения на клиентите</h2>
            <ul className="list-disc pl-5 space-y-2 mt-2">
              <li>Клиентът е длъжен да предостави точен адрес за вземане.</li>
              <li>За пътувания в чужбина клиентът трябва да уведоми предварително.</li>
              <li>Пушенето в превозните средства е забранено, освен ако шофьорът изрично позволи.</li>
              <li>Клиентът трябва да заплати дължимата сума по тарифата на компанията.</li>
              <li>За поръчки с последващо отказване клиентът може да бъде санкциониран.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">5. Плащания</h2>
            <p>
              Всички цени са в евро (EUR) и се изчисляват автоматично от системата
              въз основа на базова тарифа, разстояние, време и налични промоции.
              Плащането е само в брой на шофьора след пътуването.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">6. Отговорност</h2>
            <p>
              Платформата не носи отговорност за претърпени вреди при ползване на
              превозни услуги от трети лица (шофьори/компании), освен ако вредата
              не е пряка последица от техническа неизправност на Платформата.
              Спорове между клиенти и шофьори се разрешават между страните или
              със съдействието на съответната компания за каручки.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">7. Промени в Общите условия</h2>
            <p>
              Платформата си запазва правото да изменя настоящите Общи условия
              едностранно. Промените влизат в сила 7 дни след публикуването им на
              сайта. Продължаващото използване на услугите след този срок се счита
              за съгласие с новите условия.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">8. Контакти</h2>
            <p>
              За въпроси и жалби: info@leski-karuchka.bg или тел. +359 89 000 5900.
            </p>
          </section>

          <p className="text-xs text-foreground-400 pt-4 border-t border-background-200">
            Последна актуализация: 13 август 2026 г.
          </p>
        </div>
      </div>
    </div>
  );
}
