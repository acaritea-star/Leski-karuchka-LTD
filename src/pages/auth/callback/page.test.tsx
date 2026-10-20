// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import bg from '@/i18n/local/bg/common';
import AuthCallback from './page';

const legal = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock('@/lib/legalAcceptance', () => ({ finishLegalIntent: legal.finish }));
const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn(), getSession: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const value = bg[key as keyof typeof bg];
  return typeof value === 'string' ? value : key;
} }) }));
beforeEach(() => {
  vi.clearAllMocks();
  legal.finish.mockResolvedValue(undefined);
  window.history.replaceState({}, '', '/auth/callback');
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });
const renderCallback = () => render(<StrictMode><MemoryRouter initialEntries={['/auth/callback']}><Routes>
  <Route path="/auth/callback" element={<AuthCallback />} />
  <Route path="/app" element={<p>Authenticated app</p>} />
  <Route path="/auth/login" element={<p>Login page</p>} />
</Routes></MemoryRouter></StrictMode>);

describe('Google and Facebook PKCE callback', () => {
  it('exchanges the code once under Strict Mode and removes it from the address bar', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=one-time-code');
    renderCallback();
    expect(await screen.findByText('Authenticated app')).toBeTruthy();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('one-time-code');
    expect(window.location.search).toBe('');
  });
  it.each(['?error=access_denied&code=unused', '#error=access_denied&error_description=private-provider-details'])('handles rejection in %s before exchanging anything', async suffix => {
    window.history.replaceState({}, '', '/auth/callback' + suffix);
    renderCallback();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_error_cancelled);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(window.location.search + window.location.hash).toBe('');
  });
  it('does not enter the app after a failed code exchange', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=expired');
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: 'Expired code: private-details' } });
    renderCallback();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_error_generic);
    expect(screen.queryByText('Authenticated app')).toBeNull();
  });
  it('allows a refresh with a saved session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
    renderCallback();
    expect(await screen.findByText('Authenticated app')).toBeTruthy();
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it('shows recovery when no code or saved session exists', async () => {
    renderCallback();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(bg.auth_callback_missing));
    expect(screen.getByRole('link', { name: bg.auth_callback_back }).getAttribute('href')).toBe('/auth/login');
  });
});

it('continues staff OAuth to MFA when legal acceptance requires the second factor', async () => {
  window.history.replaceState({}, '', '/auth/callback?code=staff-code');
  legal.finish.mockRejectedValue({ code: '42501', message: 'MFA_REQUIRED: complete two-factor authentication' });
  renderCallback();
  expect(await screen.findByText('Authenticated app')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('still reports other legal authorization errors instead of treating them as MFA', async () => {
  window.history.replaceState({}, '', '/auth/callback?code=staff-code');
  legal.finish.mockRejectedValue({ code: '42501', message: 'Permission denied' });
  renderCallback();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Authenticated app')).toBeNull();
});

it.each([401, 503, 0])('recovers a transient first-login acceptance rejection (%s) using the same session', async status => {
  window.history.replaceState({}, '', '/auth/callback?code=new-customer');
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  legal.finish.mockRejectedValueOnce({ code: 'PGRST301', status, message: 'Temporary rejection' });
  renderCallback();
  expect(await screen.findByText('Authenticated app')).toBeTruthy();
  expect(auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  expect(legal.finish).toHaveBeenCalledTimes(2);
});

it('retries completion without reusing a consumed OAuth code or requiring logout', async () => {
  window.history.replaceState({}, '', '/auth/callback?code=consumed');
  legal.finish.mockRejectedValueOnce({ code: '42501', status: 403, message: 'Permission denied' });
  renderCallback();
  await screen.findByRole('alert');
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user' } } }, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  expect(await screen.findByText('Authenticated app')).toBeTruthy();
  expect(auth.exchangeCodeForSession).toHaveBeenCalledOnce();
});

it('does not retry acceptance for another account after a session changes', async () => {
  window.history.replaceState({}, '', '/auth/callback?code=new-customer');
  auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'other' } } }, error: null });
  legal.finish.mockRejectedValueOnce({ status: 401, message: 'Unauthorized' });
  renderCallback();
  await screen.findByRole('alert');
  expect(legal.finish).toHaveBeenCalledOnce();
  expect(screen.queryByText('Authenticated app')).toBeNull();
});
