import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function CookiesPage() {
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
            Политика за бисквитки
          </h1>
        </div>

        <div className="bg-white rounded-2xl border border-background-200 p-6 md:p-8 space-y-8 text-sm text-foreground-700 leading-relaxed">
          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">1. Какво са бисквитки</h2>
            <p>
              Бисквитките са малки текстови файлове, които се съхраняват на вашето устройство
              (компютър, таблет или телефон) от уеб браузъра при посещение на уебсайт.
              Те помагат на сайта да „запомни" вашите действия и предпочитания за определен
              период от време, така че да не се налага да ги въвеждате отново при всяко
              посещение или при преминаване от една страница към друга.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">2. Какви бисквитки използваме</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm mt-2 border border-background-200 rounded-lg">
                <thead className="bg-background-100 text-foreground-700 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Категория</th>
                    <th className="px-4 py-3">Цел</th>
                    <th className="px-4 py-3">Срок</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-background-200">
                  <tr>
                    <td className="px-4 py-3 font-medium">Необходими (сесийни)</td>
                    <td className="px-4 py-3">Поддържане на сесията за вход и сигурност.</td>
                    <td className="px-4 py-3">Сесия — до излизане</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Предпочитания</td>
                    <td className="px-4 py-3">Запомняне на избран език и настройки на интерфейса.</td>
                    <td className="px-4 py-3">1 година</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 font-medium">Функционални</td>
                    <td className="px-4 py-3">Запомняне на любими адреси и настройки на акаунта.</td>
                    <td className="px-4 py-3">1 година</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3">
              <strong>Важно:</strong> Не използваме аналитични, рекламни или проследяващи бисквитки
              от трети страни (Google Analytics, Facebook Pixel и др.).
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">3. Как да управлявате бисквитките</h2>
            <p>
              Можете да контролирате и/или изтривате бисквитки по всяко време през настройките
              на вашия браузър. Можете да изтриете всички бисквитки, които вече са запазени на
              вашето устройство, и можете да настроите повечето браузъри да ги блокират.
              Ако направите това обаче, може да се наложи ръчно да настройвате някои
              предпочитания всеки път, когато посещавате сайт, а някои услуги и функции
              може да не работят.
            </p>
            <ul className="list-disc pl-5 space-y-1 mt-2">
              <li><a href="https://support.google.com/chrome/answer/95647" target="_blank" rel="noopener noreferrer nofollow" className="text-primary-600 hover:text-primary-700">Google Chrome</a></li>
              <li><a href="https://support.mozilla.org/kb/cookies-information-websites-store-on-your-computer" target="_blank" rel="noopener noreferrer nofollow" className="text-primary-600 hover:text-primary-700">Mozilla Firefox</a></li>
              <li><a href="https://support.apple.com/guide/safari/manage-cookies-sfri11471/mac" target="_blank" rel="noopener noreferrer nofollow" className="text-primary-600 hover:text-primary-700">Safari</a></li>
              <li><a href="https://support.microsoft.com/help/4027947/microsoft-edge-delete-cookies" target="_blank" rel="noopener noreferrer nofollow" className="text-primary-600 hover:text-primary-700">Microsoft Edge</a></li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">4. Съгласие</h2>
            <p>
              При първо посещение на Платформата ще видите банер с информация за бисквитките.
              Продължавайки да използвате сайта, вие се съгласявате с използването на
              описаните по-горе необходими и функционални бисквитки.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-foreground-950 text-base mb-3">5. Контакт</h2>
            <p>
              За въпроси относно бисквитките: info@leski-karuchka.bg.
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