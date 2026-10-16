import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { needsStaffMfa, sessionHasMfa, STAFF_MFA_REQUIRED_EVENT } from '@/lib/staffMfa';
import { queryClient } from '@/lib/queryClient';
import { stopSharedGps } from '@/lib/sharedGps';
import { stopDriverGps } from '@/lib/driverLocation';

const StaffMfa = lazy(() => import('./StaffMfa'));
export default function StaffMfaBoundary({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const [deniedToken, setDeniedToken] = useState<string | null>(null);
  const token = session?.access_token;
  useEffect(() => {
    const deny = (event: Event) => { if ((event as CustomEvent).detail === token) setDeniedToken(token ?? null); };
    window.addEventListener(STAFF_MFA_REQUIRED_EVENT, deny);
    return () => window.removeEventListener(STAFF_MFA_REQUIRED_EVENT, deny);
  }, [token]);
  const required = needsStaffMfa(user?.role) && (!sessionHasMfa(session) || !!token && deniedToken === token);
  useEffect(() => {
    if (required) { queryClient.clear(); stopSharedGps(); stopDriverGps(); }
  }, [required]);
  if (!required) return children;
  return <main className="min-h-[100dvh] bg-background-50 p-4 flex items-center justify-center">
    <Suspense fallback={<p role="status">Зареждане на защитения вход…</p>}><StaffMfa key={user!.id} onDone={() => setDeniedToken(null)} /></Suspense>
  </main>;
}
