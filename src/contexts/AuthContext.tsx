import { queryClient } from '@/lib/queryClient';
import { stopDriverGps } from '@/lib/driverLocation';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser, Session, AuthResponse, OAuthResponse } from '@supabase/supabase-js';
import type { Tables } from '@/lib/database.types';

export interface AppUser {
  id: string;
  email?: string;
  role: 'CUSTOMER' | 'DRIVER' | 'COMPANY_ADMIN' | 'SUPER_ADMIN';
  company_id: string | null;
  first_name: string;
  last_name: string;
  phone: string;
  avatar_url: string | null;
}

interface AuthContextType {
  user: AppUser | null;
  session: Session | null;
  loading: boolean;
  profileError: string | null;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  signInWithOAuth: (provider: 'google' | 'facebook') => Promise<OAuthResponse>;
  signUp: (email: string, password: string, metadata: Record<string, string>) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<AppUser>) => Promise<{ data: Tables<'profiles'> | null; error: { message: string } | null }>;
}

// Result of a profile lookup: we keep the real API error separate from the
// "there is simply no profile row" case so the UI never lies about the cause.
type ProfileResult = { user: AppUser | null; error: string | null };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be inside AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const enrichWithDriverCompany = useCallback(
    async (baseUser: AppUser): Promise<AppUser> => {
      if (baseUser.role === 'DRIVER' && !baseUser.company_id) {
        try {
          const { data } = await supabase
            .from('drivers')
            .select('company_id')
            .eq('user_id', baseUser.id)
            .maybeSingle();
          if (data?.company_id) {
            return { ...baseUser, company_id: data.company_id };
          }
        } catch (err) {
          console.error('Error fetching driver company:', err);
        }
      }
      return baseUser;
    },
    [],
  );

  const buildAppUser = useCallback(
    async (data: Tables<'profiles'> | null, authUser: SupabaseUser): Promise<ProfileResult> => {
      if (!data) return { user: null, error: null };
      if (!data.is_active) {
        return { user: null, error: 'Профилът е деактивиран. Свържи се с поддръжката.' };
      }
      const baseUser: AppUser = {
        id: data.id,
        email: authUser.email,
        role: data.role,
        company_id: data.company_id,
        first_name: data.first_name || '',
        last_name: data.last_name || '',
        phone: data.phone || '',
        avatar_url: data.avatar_url,
      };
      return { user: await enrichWithDriverCompany(baseUser), error: null };
    },
    [enrichWithDriverCompany],
  );

  const doFetchProfile = useCallback(
    async (authUser: SupabaseUser): Promise<ProfileResult> => {
      // Right after an OAuth/PKCE sign-in the access token can still be
      // settling in, so a single query may briefly fail. Retry a few times
      // before concluding the profile is unavailable.
      const retryDelaysMs = [0, 400, 1200];
      let lastError: string | null = null;

      for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        if (retryDelaysMs[attempt] > 0) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => { setTimeout(resolve, retryDelaysMs[attempt]); });
        }

        try {
          // Make sure the client actually holds a session before querying —
          // without it the request goes out unauthenticated and RLS returns
          // zero rows with no error.
          // eslint-disable-next-line no-await-in-loop
          const { data: sessionData } = await supabase.auth.getSession();
          const hasToken = Boolean(sessionData.session?.access_token);

          // eslint-disable-next-line no-await-in-loop
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .maybeSingle();

          if (error) {
            // A rejected request (401 / missing table / clock-skewed JWT) is a
            // real failure — remember it instead of pretending the row is gone.
            lastError = error.message || 'Грешка при зареждане на профила.';
            console.error('[AuthContext] fetchProfile query error:', error);
            continue;
          }

          if (data) {
            // eslint-disable-next-line no-await-in-loop
            return await buildAppUser(data, authUser);
          }

          console.warn(
            `[AuthContext] fetchProfile: no profile for user ${authUser.id} (attempt ${attempt + 1}, token: ${hasToken})`,
          );
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          console.error('[AuthContext] fetchProfile exception:', e);
        }
      }

      // Rows genuinely missing -> error stays null. API failures -> real message.
      return { user: null, error: lastError };
    },
    [buildAppUser],
  );

  // In-flight dedup: concurrent fetchProfile calls for the same user share a
  // single promise instead of firing parallel duplicate requests.
  const profileFetchRef = useRef<{ userId: string; promise: Promise<ProfileResult> } | null>(null);

  const fetchProfile = useCallback(
    (authUser: SupabaseUser): Promise<ProfileResult> => {
      if (profileFetchRef.current?.userId === authUser.id) {
        return profileFetchRef.current.promise;
      }
      const promise = doFetchProfile(authUser).finally(() => {
        if (profileFetchRef.current?.userId === authUser.id) {
          profileFetchRef.current = null;
        }
      });
      profileFetchRef.current = { userId: authUser.id, promise };
      return promise;
    },
    [doFetchProfile],
  );

  useEffect(() => {
    let alive = true;
    let revision = 0;
    let lastUserId: string | undefined;
    const applySession = (next: Session | null) => {
      if (!alive) return;
      const current = ++revision;
      if (lastUserId !== next?.user.id) {
        queryClient.clear(); stopDriverGps(); setUser(null); setProfileError(null);
        profileFetchRef.current = null;
      }
      lastUserId = next?.user.id;
      setSession(next); setLoading(!!next);
      if (!next) return;
      // Leave Supabase's auth callback before making another authenticated request.
      setTimeout(() => {
        if (!alive || current !== revision) return;
        void fetchProfile(next.user).then(result => {
          if (alive && current === revision) {
            setUser(result.user);
            setProfileError(result.error);
            setLoading(false);
          }
        });
      }, 0);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => applySession(next));
    void supabase.auth.getSession().then(({ data }) => { if (!revision) applySession(data.session); })
      .catch(() => { if (!revision) applySession(null); });
    return () => { alive = false; revision++; subscription.unsubscribe(); };
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const next = data.session;
    if (!next) { setUser(null); return; }
    profileFetchRef.current = null;
    setLoading(true);
    try {
      const result = await fetchProfile(next.user);
      setUser(result.user);
      setProfileError(result.error);
    } finally {
      setLoading(false);
    }
  }, [fetchProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      
      const result = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return result;
    },
    [],
  );

  const signInWithOAuth = useCallback(
    async (provider: 'google' | 'facebook') => {
      // Register this origin's callback in Supabase Auth's redirect allowlist.
      const redirectTo = `${window.location.origin}/auth/callback`;
      
      return await supabase.auth.signInWithOAuth({provider,options:{redirectTo}});
    },
    [],
  );

  const signUp = useCallback(
    async (email: string, password: string, metadata: Record<string, string>) => {
      
      const result = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata },
      });
      
      return result;
    },
    [],
  );

  const signOut = useCallback(async () => {
    stopDriverGps();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    queryClient.clear();
    setUser(null);
    setSession(null);
  }, []);

  const updateProfile = useCallback(
    async (updates: Partial<AppUser>): Promise<{ data: Tables<'profiles'> | null; error: { message: string } | null }> => {
      if (!user) return { data: null, error: new Error('Not authenticated') };

      const updateData: { first_name?: string | null; last_name?: string | null; phone?: string | null; avatar_url?: string | null } = {};
      if (updates.first_name !== undefined) updateData.first_name = updates.first_name;
      if (updates.last_name !== undefined) updateData.last_name = updates.last_name;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.avatar_url !== undefined) updateData.avatar_url = updates.avatar_url;

      const { data, error } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select('*')
        .maybeSingle();

      if (!error && data) {
        setUser({
          ...user,
          first_name: data.first_name ?? '',
          last_name: data.last_name ?? '',
          phone: data.phone ?? '',
          avatar_url: data.avatar_url,
        });
      }
      return { data, error };
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, session, loading, profileError, refreshProfile, signIn, signInWithOAuth, signUp, signOut, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
