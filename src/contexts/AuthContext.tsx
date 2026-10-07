import { withRequestTimeout } from '@/lib/requestTimeout';
import { stopSharedGps } from '@/lib/sharedGps';
import { queryClient } from '@/lib/queryClient';
import { stopDriverGps } from '@/lib/driverLocation';
import { unregisterPush } from '@/lib/pushSubscription';
import { clearRecentLocations } from '@/lib/cookieConsent';
import { startSocialSignIn, type SocialProvider } from '@/lib/socialAuth';
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { supabase } from '@/lib/supabase';
import type { User as SupabaseUser, Session, OAuthResponse } from '@supabase/supabase-js';
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
  signInWithOAuth: (provider: SocialProvider) => Promise<OAuthResponse>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<AppUser>) => Promise<{ data: Tables<'profiles'> | null; error: { message: string } | null }>;
}

// Result of a profile lookup: we keep the real API error separate from the
// "there is simply no profile row" case so the UI never lies about the cause.
type ProfileResult = { user: AppUser | null; error: string | null; retryable?: boolean };
const CONNECTION_ERROR = 'Връзката се забави. Провери интернета и опитай отново.';

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
  const currentUser = useRef(user);
  currentUser.current = user;
  const currentSession = useRef<Session | null>(null);
  const applySessionRef = useRef<((next: Session | null) => Promise<void>) | null>(null);

  const enrichWithDriverCompany = useCallback(
    async (baseUser: AppUser): Promise<AppUser> => {
      if (baseUser.role === 'DRIVER' && !baseUser.company_id) {
        try {
          const { data } = await withRequestTimeout(signal => supabase
            .from('drivers')
            .select('company_id')
            .eq('user_id', baseUser.id)
            .abortSignal(signal).maybeSingle());
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
      let retryable = false;

      for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
        if (retryDelaysMs[attempt] > 0) {
          await new Promise((resolve) => { setTimeout(resolve, retryDelaysMs[attempt]); });
        }

        try {
          // Make sure the client actually holds a session before querying —
          // without it the request goes out unauthenticated and RLS returns
          // zero rows with no error.
          const { data: sessionData, error: sessionError } = await withRequestTimeout(() => supabase.auth.getSession());
          if (sessionError) throw sessionError;
          if (sessionData.session?.user.id !== authUser.id) return { user: null, error: null };
          const hasToken = Boolean(sessionData.session?.access_token);

          const { data, error, status } = await withRequestTimeout(signal => supabase
            .from('profiles')
            .select('*')
            .eq('id', authUser.id)
            .abortSignal(signal)
            .maybeSingle());

          if (error) {
            // A rejected request (401 / missing table / clock-skewed JWT) is a
            // real failure — remember it instead of pretending the row is gone.
            lastError = error.message || 'Грешка при зареждане на профила.';
            retryable = !status || status >= 500 || status === 429;
            console.error('[AuthContext] fetchProfile query error:', error);
            if (!retryable) return { user: null, error: lastError };
            continue;
          }

          if (data) {
            return await buildAppUser(data, authUser);
          }
          lastError = null;
          retryable = false;

          console.warn(
            `[AuthContext] fetchProfile: no profile for user ${authUser.id} (attempt ${attempt + 1}, token: ${hasToken})`,
          );
        } catch (e) {
          lastError = e instanceof Error ? e.message : String(e);
          retryable = e instanceof TypeError || (e instanceof Error && ['TimeoutError', 'AbortError', 'AuthRetryableFetchError'].includes(e.name));
          console.error('[AuthContext] fetchProfile exception:', e);
        }
      }

      // Rows genuinely missing -> error stays null. API failures -> real message.
      return { user: null, error: retryable ? CONNECTION_ERROR : lastError, retryable };
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
        if (profileFetchRef.current?.promise === promise) {
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
    const applySession = async (next: Session | null) => {
      if (!alive) return;
      const current = ++revision;
      const identityChanged = lastUserId !== next?.user.id;
      if (identityChanged) {
        queryClient.clear(); stopDriverGps(); stopSharedGps(); setUser(null); setProfileError(null);
        currentUser.current = null;
        if (lastUserId) clearRecentLocations();
        profileFetchRef.current = null;
      }
      lastUserId = next?.user.id;
      currentSession.current = next;
      setSession(next);
      if (!next) setProfileError(null);
      // A refresh/confirmed sign-in for the same account validates its profile
      // in the background. It must not unmount maps, forms and booking state.
      setLoading(!!next && (identityChanged || !currentUser.current));
      if (!next) return;
      // Leave Supabase's auth callback before making another authenticated request.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (!alive || current !== revision) return;
      await fetchProfile(next.user).then(result => {
        if (alive && current === revision && currentSession.current?.user.id === next.user.id) {
          // Keep the last verified identity through a transient network failure.
          // Missing, disabled and permission-denied profiles still fail closed.
          if (!result.retryable || currentUser.current?.id !== next.user.id) {
            currentUser.current = result.user;
            setUser(result.user);
          }
          setProfileError(result.error);
          setLoading(false);
        }
      });
    };
    applySessionRef.current = applySession;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { void applySession(next); });
    void withRequestTimeout(() => supabase.auth.getSession()).then(({ data, error }) => {
      if (error) throw error;
      if (!revision) void applySession(data.session);
    }).catch(() => {
      if (alive && !revision) { setProfileError(CONNECTION_ERROR); setLoading(false); }
    });
    return () => { alive = false; revision++; applySessionRef.current = null; subscription.unsubscribe(); };
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    const expected = currentSession.current;
    try {
      const { data, error } = await withRequestTimeout(() => supabase.auth.getSession());
      if (error) throw error;
      if (currentSession.current !== expected) return;
      await applySessionRef.current?.(data.session);
    } catch {
      if (currentSession.current === expected) { setProfileError(CONNECTION_ERROR); setLoading(false); }
    }
  }, []);

  const signInWithOAuth = useCallback(
    (provider: SocialProvider) => startSocialSignIn(provider),
    [],
  );

  const signOut = useCallback(async () => {
    if (session?.user.id) {
      try { await withRequestTimeout(() => unregisterPush(session.user.id)); }
      catch { console.warn('Push cleanup failed; notification permission can be revoked in browser settings.'); }
    }
    if (currentSession.current?.user.id !== session?.user.id) return;
    const { error } = await withRequestTimeout(() => supabase.auth.signOut());
    if (error) throw error;
    stopDriverGps(); stopSharedGps();
    clearRecentLocations();
    queryClient.clear();
    setUser(null);
    setSession(null);
    currentUser.current = null;
    currentSession.current = null;
  }, [session?.user.id]);

  const updateProfile = useCallback(
    async (updates: Partial<AppUser>): Promise<{ data: Tables<'profiles'> | null; error: { message: string } | null }> => {
      if (!user) return { data: null, error: new Error('Not authenticated') };

      const updateData: { first_name?: string | null; last_name?: string | null; phone?: string | null; avatar_url?: string | null } = {};
      if (updates.first_name !== undefined) updateData.first_name = updates.first_name;
      if (updates.last_name !== undefined) updateData.last_name = updates.last_name;
      if (updates.phone !== undefined) updateData.phone = updates.phone;
      if (updates.avatar_url !== undefined) updateData.avatar_url = updates.avatar_url;

      try {
        const { data, error } = await withRequestTimeout(signal => supabase
          .from('profiles')
          .update(updateData)
          .eq('id', user.id)
          .select('*')
          .abortSignal(signal).single());

        if (!error && data && currentSession.current?.user.id === user.id && currentUser.current?.id === user.id) {
          const next = {
            ...currentUser.current,
            first_name: data.first_name ?? '',
            last_name: data.last_name ?? '',
            phone: data.phone ?? '',
            avatar_url: data.avatar_url,
          };
          currentUser.current = next;
          setUser(next);
        }
        return { data, error };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : CONNECTION_ERROR } };
      }
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{ user, session, loading, profileError, refreshProfile, signInWithOAuth, signOut, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
