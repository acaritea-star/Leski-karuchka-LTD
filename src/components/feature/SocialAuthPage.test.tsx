// @vitest-environment jsdom
import { StrictMode } from 'react';
import { beginDriverApplicationLogin } from '@/lib/authReturn';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import bg from '@/i18n/local/bg/common';
import LoginPage from '@/pages/auth/login/page';
import RegisterPage from '@/pages/auth/register/page';

const auth = vi.hoisted(() => ({ signInWithOAuth: vi.fn(), session: null as unknown, loading: false }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => {
  const value = bg[key as keyof typeof bg];
  return typeof value === 'string' ? value : key;
} }) }));

beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks(); auth.session = null; auth.loading = false;
  auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.test/login' }, error: null });
});
afterEach(cleanup);
const renderLogin = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);

describe('two social sign-in options', () => {
  it('preserves an application return under Strict Mode with an existing session', async () => {
    auth.session = { user: { id: 'candidate' } };
    beginDriverApplicationLogin();
    render(<StrictMode><MemoryRouter initialEntries={['/auth/login']}><Routes>
      <Route path="/auth/login" element={<LoginPage />} /><Route path="/driver-join" element={<p>Application form</p>} /><Route path="/app" element={<p>Wrong destination</p>} />
    </Routes></MemoryRouter></StrictMode>);
    expect(await screen.findByText('Application form')).toBeTruthy();
    expect(screen.queryByText('Wrong destination')).toBeNull();
  });
  it.each([LoginPage, RegisterPage])('shows only Google and Facebook on %p', Page => {
    const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Продължи с Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Продължи с Facebook' })).toBeTruthy();
    expect(container.querySelector('input[type="email"], input[type="password"]')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Общи условия' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Политиката за поверителност' }).getAttribute('href')).toBe('/privacy');
    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-describedby')).toBe('auth-legal-notice');
    }
  });
  it.each([LoginPage, RegisterPage])('starts OAuth from one click on %p with the terms notice visible', async Page => {
    render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getByText(bg.auth_continue_accept_prefix, { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Facebook' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledOnce());
    expect(auth.signInWithOAuth).toHaveBeenCalledWith('facebook');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it.each(['Google', 'Facebook'])('starts %s and prevents a second OAuth request', async provider => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: `Продължи с ${provider}` }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith(provider.toLowerCase()));
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Google' }));
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
  });
  it('offers recovery on an unavailable provider', async () => {
    auth.signInWithOAuth.mockRejectedValue(new Error('provider_disabled'));
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Facebook' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_error_unavailable);
    expect((screen.getByRole('button', { name: 'Продължи с Google' }) as HTMLButtonElement).disabled).toBe(false);
    auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.test/login' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenLastCalledWith('google'));
  });
  it('shows a safe error and unlocks both buttons after an OAuth error response', async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'raw provider details' } });
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Google' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_error_generic);
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(false);
  });
  it('continues an existing session through the normal role redirect', async () => {
    auth.session = { user: { id: 'existing-user' } };
    render(<MemoryRouter initialEntries={['/auth/login']}><Routes>
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/app" element={<p>Existing session</p>} />
    </Routes></MemoryRouter>);
    expect(await screen.findByText('Existing session')).toBeTruthy();
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });
});
