// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startSocialSignIn, socialAuthErrorKey } from './socialAuth';

const { signInWithOAuth } = vi.hoisted(() => ({ signInWithOAuth: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth } },
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'public-test-key',
}));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.test/login' }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe('social OAuth requests', () => {
  it('keeps the existing Google flow and the site callback', async () => {
    await startSocialSignIn('google');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  });
  it('requests Facebook email through Supabase after checking public provider availability', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ external: { facebook: true } }) });
    await startSocialSignIn('facebook');
    expect(fetchMock).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/settings', expect.objectContaining({
      headers: { apikey: 'public-test-key', Accept: 'application/json' }, cache: 'no-store',
    }));
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'facebook', options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: 'email' },
    });
  });
  it('does not redirect to a disabled Facebook provider', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ external: { facebook: false } }) });
    await expect(startSocialSignIn('facebook')).rejects.toThrow('provider_disabled');
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
  it('does not assume an unreadable provider response grants access', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    await expect(startSocialSignIn('facebook')).rejects.toThrow('provider_check_failed');
    expect(signInWithOAuth).not.toHaveBeenCalled();
  });
});

describe('safe sign-in errors', () => {
  it.each([
    [{ code: 'access_denied' }, 'auth_error_cancelled'],
    [{ message: 'Email not provided' }, 'auth_error_email'],
    [new Error('provider_disabled'), 'auth_error_unavailable'],
    [{ status: 429 }, 'auth_error_rate'],
    [new TypeError('fetch failed'), 'auth_error_network'],
    [{ message: 'raw secret provider response' }, 'auth_error_generic'],
  ])('provides a safe message for %j', (error, key) => {
    expect(socialAuthErrorKey(error)).toBe(key);
  });
});
