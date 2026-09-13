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
  signIn: (email: string, password: string) => Promise<AuthResponse>;
  signInWithOAuth: (provider: 'google' | 'facebook') => Promise<OAuthResponse>;
  signUp: (email: string, password: string, metadata: Record<string, string>) => Promise<AuthResponse>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<AppUser>) => Promise<{ data: Tables<'profiles'> | null; error: { message: string } | null }>;
}

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
    async (data: Tables<'profiles'> | null, authUser: SupabaseUser): Promise<AppUser | null> => {
      if (!data) {
        console.error('Error fetching profile: no data');
        return null;
      }
      if (!data.is_active) return null;
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
      return await enrichWithDriverCompany(baseUser);
    },
    [enrichWithDriverCompany],
  );

  const doFetchProfile = useCallback(
    async (authUser: SupabaseUser): Promise<AppUser | null> => {
      
      try {
        // The session and profiles_select_own policy identify the caller.
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', authUser.id)
          .abortSignal(AbortSignal.timeout(10_000))
          .maybeSingle();

        if (error) {
          console.error('[AuthContext] fetchProfile query error:', error);
          return null;
        }

        if (!data) {
          console.error('[AuthContext] fetchProfile: no profile found for user', authUser.id);
          return null;
        }

        
        return await buildAppUser(data, authUser);
      } catch (e) {
        console.error('[AuthContext] fetchProfile exception:', e);
        return null;
      }
    },
    [buildAppUser],
  );

  // In-flight dedup: concurrent fetchProfile calls for the same user share a
  // single promise instead of firing parallel duplicate requests.
  const profileFetchRef = useRef<{ userId: string; promise: Promise<AppUser | null> } | null>(null);

  const fetchProfile = useCallback(
    (authUser: SupabaseUser): Promise<AppUser | null> => {
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
        queryClient.clear(); stopDriverGps(); setUser(null);
        profileFetchRef.current = null;
      }
      lastUserId = next?.user.id;
      setSession(next); setLoading(!!next);
      if (!next) return;
      // Leave Supabase's auth callback before making another authenticated request.
      setTimeout(() => {
        if (!alive || current !== revision) return;
        void fetchProfile(next.user).then(profile => {
          if (alive && current === revision) { setUser(profile); setLoading(false); }
        });
      },0);
    };
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,next) => applySession(next));
    void supabase.auth.getSession().then(({data}) => {if(!revision) applySession(data.session);})
      .catch(() => {if(!revision) applySession(null);});
    return () => {alive=false;revision++;subscription.unsubscribe();};
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
      value={{ user, session, loading, signIn, signInWithOAuth, signUp, signOut, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
