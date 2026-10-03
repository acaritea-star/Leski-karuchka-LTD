// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
  const { user, loading } = useAuthContext();
  return <div>{loading ? 'loading' : user ? `ready:${user.id}` : 'signed-out'}</div>;
}
beforeEach(() => { vi.clearAllMocks(); api.getSession.mockResolvedValue({ data: { session } }); api.profile.mockResolvedValue({ data: profile, error: null }); });
afterEach(cleanup);

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
