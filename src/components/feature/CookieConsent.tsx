import { useEffect, useState } from 'react';
import {
  CONSENT_CHANGED_EVENT, CONSENT_OPEN_EVENT, CONSENT_STORAGE_KEY,
  clearRecentLocations, defaultConsent, readConsent, saveConsent, updateGoogleConsent,
  type ConsentState,
} from '@/lib/cookieConsent';

declare global {
  interface Window {
    gtag?: (command: string, ...args: unknown[]) => void;
  }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [consent, setConsent] = useState<ConsentState>(defaultConsent);

  useEffect(() => {
    const sync = () => {
      const stored = readConsent();
      const next = stored ?? defaultConsent();
      setConsent(next);
      setVisible(!stored);
      if (!next.functional) clearRecentLocations();
      updateGoogleConsent(next);
    };
    const open = () => {
      setConsent(readConsent() ?? defaultConsent());
      setExpanded(true);
      setVisible(true);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === CONSENT_STORAGE_KEY || event.key === null) sync();
    };
    sync();
    window.addEventListener(CONSENT_OPEN_EVENT, open);
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, open);
      window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', sync);
    };
  }, []);

  const commit = (choice: ConsentState) => {
    saveConsent(choice);
    setConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;
  const buttonClass = 'flex-1 px-4 py-3 rounded-full border border-primary-600 text-primary-700 bg-white hover:bg-primary-50 text-sm font-semibold cursor-pointer';

  return <section aria-label="Настройки за бисквитки" className="cookie-banner">
    <div className="cookie-banner-inner">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-base font-semibold text-foreground-950 mb-2">Твоят избор за бисквитки</p>
          <p className="text-sm text-foreground-700 leading-relaxed">
            Необходимото съхранение осигурява вход и сигурност. По избор можем да запомняме
            наскоро използвани адреси на това устройство. В тази версия няма рекламни или
            аналитични тагове. Изборът може да се промени по всяко време от „Настройки за бисквитки“.
            {' '}<a href="/cookies" className="text-primary-700 underline">Бисквитки</a>
            {' · '}<a href="/privacy" className="text-primary-700 underline">Поверителност</a>
          </p>
        </div>
        {expanded && <div className="space-y-3 border-t border-background-200 pt-3">
          <p className="text-sm text-foreground-800">Необходими — винаги включени за поисканите основни функции.</p>
          <label className="flex items-center justify-between gap-4 cursor-pointer">
            <span className="text-sm text-foreground-800">
              <strong>Запомняне на адреси</strong><br />
              Незадължително удобство на това устройство. При отказ запазените адреси се премахват.
            </span>
            <input type="checkbox" checked={consent.functional}
              onChange={event => setConsent({ ...defaultConsent(), functional: event.target.checked })}
              className="cookie-toggle" />
          </label>
        </div>}
        <div className="flex flex-col sm:flex-row items-stretch gap-2.5">
          <button type="button" onClick={() => commit({ ...defaultConsent(), functional: true })} className={buttonClass}>Приеми удобствата</button>
          <button type="button" onClick={() => commit(defaultConsent())} className={buttonClass}>Само необходимите</button>
          {expanded
            ? <button type="button" onClick={() => commit(consent)} className={buttonClass}>Запази избора</button>
            : <button type="button" onClick={() => setExpanded(true)} className={buttonClass}>Настройки</button>}
        </div>
      </div>
    </div>
  </section>;
}
