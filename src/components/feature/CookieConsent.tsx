import { useEffect, useState } from 'react';

declare global {
  interface Window {
    gtag?: (command: string, ...args: unknown[]) => void;
  }
}

type ConsentState = {
  necessary: boolean;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
};

const STORAGE_KEY = 'lk_cookie_consent_v2';

function getDefaultConsent(): ConsentState {
  return {
    necessary: true,
    functional: false,
    analytics: false,
    marketing: false,
  };
}

function readStoredConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    return parsed;
  } catch {
    return null;
  }
}

function saveConsent(consent: ConsentState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(consent));
  } catch {
    /* ignore */
  }
}

function updateGtagConsent(consent: ConsentState) {
  const gtag = window.gtag;
  if (typeof gtag !== 'function') return;

  gtag('consent', 'update', {
    ad_storage: consent.marketing ? 'granted' : 'denied',
    analytics_storage: consent.analytics ? 'granted' : 'denied',
    ad_user_data: consent.marketing ? 'granted' : 'denied',
    ad_personalization: consent.marketing ? 'granted' : 'denied',
    functionality_storage: consent.functional ? 'granted' : 'denied',
    personalization_storage: consent.functional ? 'granted' : 'denied',
    security_storage: 'granted',
  });
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [consent, setConsent] = useState<ConsentState>(getDefaultConsent);

  useEffect(() => {
    const stored = readStoredConsent();
    if (!stored) {
      setVisible(true);
      // Google Consent Mode v2 default denied
      const gtag = window.gtag;
      if (typeof gtag === 'function') {
        gtag('consent', 'default', {
          ad_storage: 'denied',
          analytics_storage: 'denied',
          ad_user_data: 'denied',
          ad_personalization: 'denied',
          functionality_storage: 'denied',
          personalization_storage: 'denied',
          security_storage: 'granted',
          wait_for_update: 500,
        });
      }
    } else {
      setConsent(stored);
      updateGtagConsent(stored);
    }
  }, []);

  const acceptAll = () => {
    const all = {
      necessary: true,
      functional: true,
      analytics: true,
      marketing: true,
    };
    setConsent(all);
    saveConsent(all);
    updateGtagConsent(all);
    setVisible(false);
  };

  const rejectAll = () => {
    const minimal = getDefaultConsent();
    setConsent(minimal);
    saveConsent(minimal);
    updateGtagConsent(minimal);
    setVisible(false);
  };

  const saveCustom = () => {
    saveConsent(consent);
    updateGtagConsent(consent);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Настройки за бисквитки"
      className="cookie-banner"
    >
      <div className="cookie-banner-inner">
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-foreground-950 mb-1">
              Ние използваме бисквитки
            </p>
            <p className="text-xs text-foreground-500 leading-relaxed">
              Бисквитките ни помагат да подобрим вашето изживяване. Задължителните бисквитки
              са необходими за работа на сайта. Можете да изберете дали да приемете аналитични
              и маркетингови бисквитки. Прочетете{' '}
              <a href="/cookies" className="text-primary-600 hover:text-primary-700 underline">
                Политиката за бисквитки
              </a>{' '}
              и{' '}
              <a href="/privacy" className="text-primary-600 hover:text-primary-700 underline">
                Политиката за поверителност
              </a>.
            </p>
          </div>

          {expanded && (
            <div className="space-y-3 border-t border-background-200 pt-3">
              {([
                { key: 'necessary', label: 'Задължителни', desc: 'Необходими за работа на сайта и сигурност.', disabled: true },
                { key: 'functional', label: 'Функционални', desc: 'Запомняне на език, предпочитания и любими адреси.', disabled: false },
                { key: 'analytics', label: 'Аналитични', desc: 'Анонимна статистика за посещения и използване на сайта.', disabled: false },
                { key: 'marketing', label: 'Маркетингови', desc: 'Персонализирани оферти и рекламни кампании.', disabled: false },
              ] as { key: keyof ConsentState; label: string; desc: string; disabled: boolean }[]).map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-950">{item.label}</p>
                    <p className="text-xs text-foreground-500">{item.desc}</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={consent[item.key]}
                    disabled={item.disabled}
                    onChange={() => {
                      if (item.disabled) return;
                      setConsent((prev) => ({ ...prev, [item.key]: !prev[item.key] }));
                    }}
                    className="cookie-toggle"
                    aria-label={`${item.label} бисквитки ${item.disabled ? ' — винаги включени' : ''}`}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            <button
              onClick={acceptAll}
              className="flex-1 px-5 py-2.5 rounded-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              Приеми всички
            </button>
            <button
              onClick={rejectAll}
              className="flex-1 px-5 py-2.5 rounded-full border border-foreground-300 text-foreground-800 hover:bg-background-100 text-sm font-semibold transition-colors whitespace-nowrap cursor-pointer"
            >
              Отхвърли всички
            </button>
            {expanded ? (
              <button
                onClick={saveCustom}
                className="flex-1 px-4 py-2.5 rounded-full text-sm font-medium text-primary-600 hover:text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors whitespace-nowrap cursor-pointer"
              >
                Запази избора
              </button>
            ) : (
              <button
                onClick={() => setExpanded(true)}
                className="px-4 py-2.5 rounded-full text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                Персонализирай
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}