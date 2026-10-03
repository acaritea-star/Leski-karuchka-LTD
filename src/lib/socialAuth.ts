import { supabase, supabaseUrl, supabaseAnonKey } from '@/lib/supabase';

export type SocialProvider = 'google' | 'facebook';

export async function startSocialSignIn(provider: SocialProvider) {
  if (provider === 'facebook') {
    // The SDK builds an OAuth URL even if the provider is disabled. Check the
    // public Auth settings first so we can keep the user on a useful screen.
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabaseAnonKey, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('provider_check_failed');
    const settings = await response.json();
    if (settings?.external?.facebook !== true) throw new Error('provider_disabled');
  }

  return supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      ...(provider === 'facebook' ? { scopes: 'email' } : {}),
    },
  });
}

// Map technical responses to actionable copy; do not display provider tokens,
// raw error descriptions or account details received in the callback URL.
export function socialAuthErrorKey(error: unknown): string {
  const details = error as { code?: string; message?: string; status?: number; name?: string } | null;
  const message = `${details?.code ?? ''} ${details?.message ?? ''}`.toLowerCase();
  if (message.includes('access_denied') || message.includes('user_denied')) return 'auth_error_cancelled';
  if (message.includes('email')) return 'auth_error_email';
  if (message.includes('provider_disabled') || message.includes('unsupported provider')) return 'auth_error_unavailable';
  if (details?.status === 429 || message.includes('rate_limit') || message.includes('rate limit')) return 'auth_error_rate';
  if (details?.name === 'TypeError' || details?.name === 'TimeoutError'
    || message.includes('provider_check_failed') || message.includes('network')) return 'auth_error_network';
  return 'auth_error_generic';
}
