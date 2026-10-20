import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';

const WelcomeOnboarding = lazy(() => import('@/pages/customer/components/WelcomeOnboarding'));

/** One account-level claim; route changes and StrictMode share the pending request. */
export default function CustomerWelcomeGate() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const userId = user?.id;
  const eligible = !loading && user?.role === 'CUSTOMER' && pathname.startsWith('/customer/');
  const pending = useRef<{ userId: string; promise: Promise<boolean> } | null>(null);
  const [visibleFor, setVisibleFor] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setVisibleFor(null);
    if (!eligible || !userId) { pending.current = null; return; }
    if (pending.current?.userId !== userId) {
      pending.current = { userId, promise: withRequestTimeout(signal =>
        supabase.rpc('claim_customer_welcome').abortSignal(signal)
      ).then(({ data, error }) => {
        if (error) throw error;
        return data === true;
      }) };
    }
    // Do not abort on effect cleanup: StrictMode must receive the same claim.
    void pending.current.promise.then(first => {
      if (alive && first) setVisibleFor(userId);
    }).catch(() => { /* An unavailable introduction never blocks the app. */ });
    return () => { alive = false; };
  }, [eligible, userId]);

  if (!eligible || visibleFor !== userId) return null;
  return <Suspense fallback={null}>
    <WelcomeOnboarding firstName={user?.first_name ?? ''} onClose={() => setVisibleFor(null)} />
  </Suspense>;
}
