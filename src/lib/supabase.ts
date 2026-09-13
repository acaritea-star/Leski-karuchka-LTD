import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

export const supabaseUrl = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string).replace(/\/$/, '');
export const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string;

// Typed client — every .from('table') call is now checked against the real
// schema, so a misspelled column fails at compile time instead of at runtime.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // CRITICAL: must be true so OAuth callbacks with #access_token are parsed
    detectSessionInUrl: true,
    flowType: 'pkce',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});