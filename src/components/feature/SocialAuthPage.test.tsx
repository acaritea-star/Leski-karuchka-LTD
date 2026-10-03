// @vitest-environment jsdom
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
  vi.clearAllMocks(); auth.session = null; auth.loading = false;
  auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.test/login' }, error: null });
});
afterEach(cleanup);
const renderLogin = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);
const acceptTerms = () => fireEvent.click(screen.getByRole('checkbox'));

describe('two social sign-in options', () => {
  it.each([LoginPage, RegisterPage])('shows only Google and Facebook on %p', Page => {
    const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Продължи с Google' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Продължи с Facebook' })).toBeTruthy();
    expect(container.querySelector('input[type="email"], input[type="password"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Политиката за поверителност' }).getAttribute('href')).toBe('/privacy');
  });
  it('requires explicit terms acceptance on the login path too', async () => {
    renderLogin();
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Facebook' }));
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_terms_required);
  });
  it.each(['Google', 'Facebook'])('starts %s and prevents a second OAuth request', async provider => {
    renderLogin(); acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: `Продължи с ${provider}` }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenCalledWith(provider.toLowerCase()));
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Google' }));
    expect(auth.signInWithOAuth).toHaveBeenCalledTimes(1);
  });
  it('offers recovery on an unavailable provider', async () => {
    auth.signInWithOAuth.mockRejectedValue(new Error('provider_disabled'));
    renderLogin(); acceptTerms();
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Facebook' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', bg.auth_error_unavailable);
    expect((screen.getByRole('button', { name: 'Продължи с Google' }) as HTMLButtonElement).disabled).toBe(false);
    auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.test/login' }, error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Продължи с Google' }));
    await waitFor(() => expect(auth.signInWithOAuth).toHaveBeenLastCalledWith('google'));
  });
  it('shows a safe error and unlocks both buttons after an OAuth error response', async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: { message: 'raw provider details' } });
    renderLogin(); acceptTerms();
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
