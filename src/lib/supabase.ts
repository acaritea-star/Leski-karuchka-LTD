import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export const supabaseUrl = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string).replace(/\/$/, '');
export const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

// Serialize auth operations through a simple in-memory queue instead of the
// browser Navigator LockManager. Cross-tab LockManager contention can deadlock
// supabase-js, so a request never receives its access token and RLS silently
// returns zero rows — which produced a permanent "session exists but profile is
// null" state.
let authLockQueue: Promise<unknown> = Promise.resolve();

function inMemoryAuthLock<R>(
  _name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> {
  const run = authLockQueue.then(fn, fn);
  authLockQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Typed client — every .from('table') call is checked against the real schema,
// so a misspelled column fails at compile time instead of at runtime.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // CRITICAL: the /auth/callback page exchanges the PKCE code explicitly.
    // Auto-detection must stay OFF, otherwise the SDK and the page race to
    // exchange the same code and the session/profile can end up empty.
    detectSessionInUrl: false,
    flowType: 'pkce',
    lock: inMemoryAuthLock,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});