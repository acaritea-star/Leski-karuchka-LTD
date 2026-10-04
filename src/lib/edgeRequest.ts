import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { withRequestTimeout } from './requestTimeout';

export class EdgeRequestError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number;
  readonly code?: string;
  constructor(status: number, retryAfterSeconds = 0, code?: string) {
    super(`Edge request failed (${status})`);
    this.status = status; this.retryAfterSeconds = retryAfterSeconds; this.code = code;
  }
}

/** The pinned functions-js version cannot pass an AbortSignal to invoke().
 * Keep its authenticated JSON request shape, with a cancellable transport.
 */
export async function invokeEdge<T>(
  name: 'google-geocode' | 'google-routes' | 'road-geometry',
  body: Record<string, unknown>,
  milliseconds: number,
): Promise<{ data: T | null; error: unknown }> {
  try {
    const data = await withRequestTimeout(async signal => {
      const { data: auth, error } = await supabase.auth.getSession();
      if (error) throw error;
      // An expired call must never reach Google after a delayed session lock.
      if (signal.aborted) throw new Error('Заявката е прекратена.');
      const response = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST', signal,
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${auth.session?.access_token ?? supabaseAnonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const retry = response.headers.get('Retry-After');
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : retry ? (Date.parse(retry) - Date.now()) / 1000 : 0;
        const details = await response.json().catch(() => null) as { code?: unknown } | null;
        const code = typeof details?.code === 'string' && /^[A-Z_]{1,60}$/.test(details.code) ? details.code : undefined;
        throw new EdgeRequestError(response.status, Number.isFinite(seconds) ? Math.max(0, Math.min(90_000, Math.ceil(seconds))) : 0, code);
      }
      return await response.json() as T;
    }, milliseconds);
    return { data, error: null };
  } catch (error) { return { data: null, error }; }
}
