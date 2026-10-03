// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CookieConsent from './CookieConsent';
import { defaultConsent, openCookieSettings, readConsent, RECENT_LOCATIONS_KEY, saveConsent } from '@/lib/cookieConsent';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

describe('cookie settings access and withdrawal', () => {
  it('keeps optional address storage denied after choosing necessary only', () => {
    localStorage.setItem(RECENT_LOCATIONS_KEY, 'private addresses');
    render(<CookieConsent />);
    expect(localStorage.getItem(RECENT_LOCATIONS_KEY)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Само необходимите' }));
    expect(readConsent()?.functional).toBe(false);
    expect(screen.queryByRole('button', { name: 'Само необходимите' })).toBeNull();
  });
  it('reopens a stored choice and deletes addresses when permission is withdrawn', () => {
    saveConsent({ ...defaultConsent(), functional: true });
    localStorage.setItem(RECENT_LOCATIONS_KEY, 'private addresses');
    render(<CookieConsent />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    act(() => openCookieSettings());
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Запази избора' }));
    expect(readConsent()?.functional).toBe(false);
    expect(localStorage.getItem(RECENT_LOCATIONS_KEY)).toBeNull();
  });
});
