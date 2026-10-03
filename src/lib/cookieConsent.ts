export type ConsentState = {
  necessary: true;
  functional: boolean;
  analytics: false;
  marketing: false;
};

export const CONSENT_STORAGE_KEY = 'lk_cookie_consent_v3';
export const CONSENT_CHANGED_EVENT = 'lk:consent-changed';
export const CONSENT_OPEN_EVENT = 'lk:consent-open';
export const RECENT_LOCATIONS_KEY = 'leski_recent_locations';
export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export function defaultConsent(): ConsentState {
  return { necessary: true, functional: false, analytics: false, marketing: false };
}

export function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw);
    const now = Date.now();
    if (record.version !== 3 || !Number.isFinite(record.savedAt)
      || !Number.isFinite(record.expiresAt) || record.savedAt > now
      || record.expiresAt <= now || record.expiresAt - record.savedAt !== CONSENT_MAX_AGE_MS
      || record.consent?.necessary !== true || typeof record.consent?.functional !== 'boolean'
      || record.consent?.analytics !== false || record.consent?.marketing !== false) return null;
    return { ...defaultConsent(), functional: record.consent.functional };
  } catch {
    return null;
  }
}

export function clearRecentLocations() {
  try { localStorage.removeItem(RECENT_LOCATIONS_KEY); } catch { /* Storage can be unavailable. */ }
}

export function saveConsent(choice: ConsentState) {
  const consent = { ...defaultConsent(), functional: choice.functional === true };
  const savedAt = Date.now();
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({
      version: 3, savedAt, expiresAt: savedAt + CONSENT_MAX_AGE_MS, consent,
    }));
    localStorage.removeItem('lk_cookie_consent_v2');
  } catch { /* Use denied defaults if the browser cannot remember the choice. */ }
  if (!consent.functional) clearRecentLocations();
  updateGoogleConsent(consent);
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT));
}

export function updateGoogleConsent(consent: ConsentState) {
  window.gtag?.('consent', 'update', {
    ad_storage: 'denied', analytics_storage: 'denied',
    ad_user_data: 'denied', ad_personalization: 'denied',
    functionality_storage: consent.functional ? 'granted' : 'denied',
    personalization_storage: 'denied', security_storage: 'granted',
  });
}

export function openCookieSettings() {
  window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT));
}
