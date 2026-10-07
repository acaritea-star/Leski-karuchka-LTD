// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuthContext } from './AuthContext';

const api = vi.hoisted(() => ({ getSession: vi.fn(), profile: vi.fn(), changed: null as null | ((event: string, session: Session | null) => void), clear: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: api.getSession, onAuthStateChange: (callback: typeof api.changed) => { api.changed = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: api.profile }) }) }) }),
} }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: api.clear } }));
vi.mock('@/lib/driverLocation', () => ({ stopDriverGps: vi.fn() }));
vi.mock('@/lib/pushSubscription', () => ({ unregisterPush: vi.fn() }));
vi.mock('@/lib/socialAuth', () => ({ startSocialSignIn: vi.fn() }));
const session = { user: { id: 'a', email: 'a@example.test' }, access_token: 'test' } as Session;
const profile = { id: 'a', is_active: true, role: 'CUSTOMER', company_id: null, first_name: 'А', avatar_url: null };
function Consumer() {
  const { user, loading, profileError, refreshProfile } = useAuthContext();
  return <><div>{loading ? 'loading' : user ? `ready:${user.id}` : 'signed-out'}</div>{profileError && <p role="alert">{profileError}</p>}<button onClick={() => void refreshProfile()}>retry</button></>;
}
beforeEach(() => { vi.clearAllMocks(); api.getSession.mockResolvedValue({ data: { session } }); api.profile.mockResolvedValue({ data: profile, error: null }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('restores an existing session and keeps the app ready during token refresh', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  let resolve!: (value: unknown) => void;
  api.profile.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => api.changed?.('TOKEN_REFRESHED', { ...session, access_token: 'refreshed' }));
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2));
  expect(screen.queryByText('loading')).toBeNull();
  expect(screen.getByText('ready:a')).toBeTruthy();
  await act(async () => resolve({ data: profile, error: null }));
  expect(api.clear).toHaveBeenCalledTimes(1);
});

it('ignores a delayed profile response after sign-out', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  let resolve!: (value: unknown) => void;
  api.profile.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => api.changed?.('SIGNED_IN', session));
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2));
  act(() => api.changed?.('SIGNED_OUT', null));
  await act(async () => resolve({ data: profile, error: null }));
  expect(screen.getByText('signed-out')).toBeTruthy();
});

it('still rejects a profile disabled during background validation', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  api.profile.mockResolvedValueOnce({ data: { ...profile, is_active: false }, error: null });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await screen.findByText('signed-out');
});


it('keeps a verified profile through a failed background read, then recovers', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.profile.mockResolvedValue({ data: null, error: { message: 'fetch failed' }, status: 503 });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
  expect(screen.getByText('ready:a')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  api.profile.mockResolvedValue({ data: profile, error: null, status: 200 });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('bounds a stuck bootstrap and allows retry without an auth event', async () => {
  vi.useFakeTimers();
  api.getSession.mockReturnValue(new Promise(() => {}));
  render(<AuthProvider><Consumer /></AuthProvider>);
  await act(async () => { await vi.advanceTimersByTimeAsync(10001); });
  expect(screen.queryByText('loading')).toBeNull();
  expect(screen.getByRole('alert')).toBeTruthy();
  api.getSession.mockResolvedValue({ data: { session }, error: null });
  fireEvent.click(screen.getByText('retry'));
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('ready:a')).toBeTruthy();
});

it('does not preserve a profile when permission is explicitly denied', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.profile.mockResolvedValue({ data: null, error: { message: 'denied' }, status: 403 });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await screen.findByText('signed-out');
});

it('never carries the previous account into an unavailable new account', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const next = { ...session, user: { ...session.user, id: 'b' } };
  api.getSession.mockResolvedValue({ data: { session: next } });
  api.profile.mockResolvedValue({ data: null, error: { message: 'offline' }, status: 0 });
  act(() => api.changed?.('SIGNED_IN', next));
  expect(screen.queryByText('ready:a')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
  expect(screen.getByText('signed-out')).toBeTruthy();
});
