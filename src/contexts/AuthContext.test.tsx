// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuthContext } from './AuthContext';
import { stopDriverGps } from '@/lib/driverLocation';
import { changePushSession, detachPush, registerPush, startPushSession } from '@/lib/pushSubscription';

const api = vi.hoisted(() => ({ getSession: vi.fn(), signOut: vi.fn(), profile: vi.fn(), changed: null as null | ((event: string, session: Session | null) => void), clear: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: api.getSession, signOut: api.signOut, onAuthStateChange: (callback: typeof api.changed) => { api.changed = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } },
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => ({ maybeSingle: api.profile }) }) }) }),
} }));
vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: api.clear } }));
vi.mock('@/lib/driverLocation', () => ({ stopDriverGps: vi.fn() }));
vi.mock('@/lib/pushSubscription', () => ({ changePushSession: vi.fn().mockResolvedValue(undefined), detachPush: vi.fn(), startPushSession: vi.fn(), registerPush: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/socialAuth', () => ({ startSocialSignIn: vi.fn() }));
const session = { user: { id: 'a', email: 'a@example.test' }, access_token: 'test' } as Session;
const profile = { id: 'a', is_active: true, role: 'CUSTOMER', company_id: null, first_name: 'А', avatar_url: null };
function Consumer() {
  const { user, loading, profileError, refreshProfile, signOut } = useAuthContext();
  return <><div>{loading ? 'loading' : user ? `ready:${user.id}` : 'signed-out'}</div><div>{user ? `${user.role}:${user.company_id}` : ''}</div>{profileError && <p role="alert">{profileError}</p>}<button onClick={() => void refreshProfile()}>retry</button><button onClick={() => void signOut().catch(() => {})}>logout</button></>;
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
it('detaches only this device on logout and resumes the saved choice on a new login', async () => {
  api.signOut.mockResolvedValueOnce({ error: null });
  render(<AuthProvider><Consumer /></AuthProvider>); await screen.findByText('ready:a');
  fireEvent.click(screen.getByText('logout')); await screen.findByText('signed-out');
  expect(detachPush).toHaveBeenCalledWith('a');
  act(() => api.changed?.('SIGNED_IN', session)); await screen.findByText('ready:a');
  expect(startPushSession).toHaveBeenCalledTimes(2);
});
it('resumes silent push registration if logout fails and the account remains signed in', async () => {
  api.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  render(<AuthProvider><Consumer /></AuthProvider>); await screen.findByText('ready:a');
  fireEvent.click(screen.getByText('logout'));
  await waitFor(() => expect(registerPush).toHaveBeenCalledWith('a'));
  expect(screen.getByText('ready:a')).toBeTruthy(); expect(startPushSession).toHaveBeenCalledTimes(2);
});

it('ignores a delayed profile response after sign-out', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  let resolve!: (value: unknown) => void;
  api.profile.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => api.changed?.('SIGNED_IN', session));
  await waitFor(() => expect(api.profile).toHaveBeenCalledTimes(2));
  act(() => api.changed?.('SIGNED_OUT', null));
  expect(changePushSession).toHaveBeenLastCalledWith(null);
  await act(async () => resolve({ data: profile, error: null }));
  expect(screen.getByText('signed-out')).toBeTruthy();
});

it('still rejects a profile disabled during background validation', async () => {
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('ready:a');
  api.profile.mockResolvedValueOnce({ data: { ...profile, is_active: false }, error: null });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await screen.findByText('signed-out');
  expect(api.clear).toHaveBeenCalledTimes(2);
  expect(stopDriverGps).toHaveBeenCalledTimes(2);
});

it('clears cached company data and GPS when the same account moves to another firm', async () => {
  api.profile.mockResolvedValue({ data: { ...profile, role: 'COMPANY_ADMIN', company_id: 'orion' }, error: null });
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('COMPANY_ADMIN:orion');
  api.profile.mockResolvedValueOnce({ data: { ...profile, role: 'COMPANY_ADMIN', company_id: 'duvka' }, error: null });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await screen.findByText('COMPANY_ADMIN:duvka');
  expect(screen.queryByText('COMPANY_ADMIN:orion')).toBeNull();
  expect(api.clear).toHaveBeenCalledTimes(2);
  expect(stopDriverGps).toHaveBeenCalledTimes(2);
});

it('clears cached privileged data after a role is revoked on the same account', async () => {
  api.profile.mockResolvedValue({ data: { ...profile, role: 'SUPER_ADMIN' }, error: null });
  render(<AuthProvider><Consumer /></AuthProvider>);
  await screen.findByText('SUPER_ADMIN:null');
  api.profile.mockResolvedValueOnce({ data: profile, error: null });
  act(() => api.changed?.('TOKEN_REFRESHED', session));
  await screen.findByText('CUSTOMER:null');
  expect(api.clear).toHaveBeenCalledTimes(2);
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
  expect(changePushSession).toHaveBeenLastCalledWith('b');
  expect(screen.queryByText('ready:a')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1700); });
  expect(screen.getByText('signed-out')).toBeTruthy();
});
