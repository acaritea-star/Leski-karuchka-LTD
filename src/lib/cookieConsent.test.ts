// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_MAX_AGE_MS, CONSENT_STORAGE_KEY, RECENT_LOCATIONS_KEY,
  defaultConsent, readConsent, saveConsent, updateGoogleConsent } from './cookieConsent';

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T09:00:00Z')); });
afterEach(() => { localStorage.clear(); delete window.gtag; vi.useRealTimers(); });

describe('consent and local address storage', () => {
  it('requires a fresh choice instead of reusing an unversioned consent', () => {
    localStorage.setItem('lk_cookie_consent_v2', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true }));
    expect(readConsent()).toBeNull();
    saveConsent(defaultConsent());
    expect(localStorage.getItem('lk_cookie_consent_v2')).toBeNull();
  });
  it('expires permission after 180 days', () => {
    saveConsent({ ...defaultConsent(), functional: true });
    expect(readConsent()?.functional).toBe(true);
    vi.advanceTimersByTime(CONSENT_MAX_AGE_MS);
    expect(readConsent()).toBeNull();
  });
  it('rejects malformed or future-dated consent rather than granting storage', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, 'not json');
    expect(readConsent()).toBeNull();
    saveConsent(defaultConsent());
    const record = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!);
    record.consent.functional = 'true';
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    expect(readConsent()).toBeNull();
    record.consent.functional = true;
    record.savedAt += 1000; record.expiresAt += 1000;
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    expect(readConsent()).toBeNull();
  });
  it('removes addresses on withdrawal and keeps advertising denied', () => {
    window.gtag = vi.fn();
    saveConsent({ ...defaultConsent(), functional: true });
    localStorage.setItem(RECENT_LOCATIONS_KEY, 'private addresses');
    saveConsent(defaultConsent());
    expect(localStorage.getItem(RECENT_LOCATIONS_KEY)).toBeNull();
    expect(readConsent()?.functional).toBe(false);
    expect(window.gtag).toHaveBeenLastCalledWith('consent', 'update', expect.objectContaining({
      ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
      functionality_storage: 'denied',
    }));
  });
  it('never grants advertising permission when enabling address convenience', () => {
    window.gtag = vi.fn();
    updateGoogleConsent({ ...defaultConsent(), functional: true });
    expect(window.gtag).toHaveBeenCalledWith('consent', 'update', expect.objectContaining({
      functionality_storage: 'granted', analytics_storage: 'denied', ad_user_data: 'denied',
    }));
  });
});
