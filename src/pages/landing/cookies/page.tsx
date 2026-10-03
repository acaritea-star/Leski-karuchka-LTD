import { Link } from 'react-router-dom';
import LegalPage from '@/components/feature/LegalPage';
import { openCookieSettings } from '@/lib/cookieConsent';

export default function CookiesPage() {
  return <LegalPage title="Политика за бисквитки">
    <section>
      <h2>1. Бисквитки и съхранение на устройството</h2>
      <p>Освен бисквитки сайтът използва localStorage и технически кеш. Правилата за избор важат и за незадължителното локално съхранение. Не считаме разглеждането, скролването или затварянето на страница за съгласие.</p>
    </section>
    <section>
      <h2>2. Какво използва тази версия</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[550px] text-sm text-left border border-background-200">
          <caption className="text-left mb-3">Съхранение в браузъра</caption>
          <thead className="bg-background-100"><tr><th className="p-3">Категория</th><th className="p-3">Цел</th><th className="p-3">Продължителност</th></tr></thead>
          <tbody className="divide-y divide-background-200">
            <tr><td className="p-3">Необходими</td><td className="p-3">Акаунт и сесия, сигурност, изрично избран език, избор за бисквитки</td><td className="p-3">Сесията се управлява от системата за вход; изборът за бисквитки е валиден до 180 дни, след което се иска нов избор</td></tr>
            <tr><td className="p-3">Незадължителни удобства</td><td className="p-3">Запомняне на наскоро използвани адреси на устройството</td><td className="p-3">Само след отделен избор; до оттегляне, излизане от акаунта, изтичане на избора или изчистване на браузъра</td></tr>
            <tr><td className="p-3">Известия и технически кеш</td><td className="p-3">Поискани известия и зареждане на приложението</td><td className="p-3">Според настройките за известия и жизнения цикъл на приложението; известията може да се изключат и от браузъра</td></tr>
          </tbody>
        </table>
      </div>
      <p>В тази версия не са включени Google Analytics, Google Ads или други рекламни тагове. Не събираме предварително съгласие за бъдещи рекламни цели. При добавяне на такива услуги се предоставят конкретна информация и отделен избор преди активиране.</p>
      <p>Картите, адресното търсене, входът с Google и външните ресурси са описани в <Link className="underline" to="/privacy">Политиката за поверителност</Link>. Отказът от удобства не спира функциите, които изрично поискате, като вход и адресно търсене.</p>
    </section>
    <section>
      <h2>3. Избор и оттегляне</h2>
      <p>Можете да приемете незадължителните удобства, да останете само с необходимите или да запазите индивидуален избор. Опциите за приемане и отказ са равностойни. Можете да промените избора от долната част на сайта, менюто на приложението или този бутон.</p>
      <button type="button" onClick={openCookieSettings} className="rounded-full border border-primary-600 px-5 py-3 text-primary-700 font-semibold cursor-pointer">Настройки за бисквитки</button>
      <p>Отказът премахва локално запомнените адреси и се отразява на последващото използване. Браузърът ви позволява да изчистите съхранението и разрешенията за сайта. Това може да прекрати сесията за вход.</p>
    </section>
    <section>
      <h2>4. Контакт</h2>
      <p>За въпроси и права използвайте контактите в <Link className="underline" to="/privacy">Политиката за поверителност</Link>.</p>
    </section>
  </LegalPage>;
}
