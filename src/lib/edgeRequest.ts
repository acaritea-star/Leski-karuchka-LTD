import { supabase, supabaseAnonKey, supabaseUrl } from './supabase';
import { withRequestTimeout } from './requestTimeout';

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
      if (!response.ok) throw new Error(`Edge request failed (${response.status})`);
      return await response.json() as T;
    }, milliseconds);
    return { data, error: null };
  } catch (error) { return { data: null, error }; }
}
