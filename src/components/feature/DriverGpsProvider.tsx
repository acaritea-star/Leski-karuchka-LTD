import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';
import { startDriverGps, stopDriverGps, getGpsStats, GPS_STALE_MS } from '@/lib/driverLocation';

type GpsState = { status: 'idle' | 'tracking' | 'stale' | 'error'; error: string };
const Context = createContext<GpsState>({ status: 'idle', error: '' });
export const useDriverGps = () => useContext(Context);

export default function DriverGpsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isDriver = user?.role === 'DRIVER';
  const { data: driver } = useQuery({
    queryKey: user?.id ? queryKeys.driverRecord(user.id) : ['drivers','none'],
    queryFn: async () => {
      const { data, error } = await supabase.from('drivers').select('*').eq('user_id', user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isDriver, refetchInterval: isDriver ? 15_000 : false, refetchOnWindowFocus: true,
  });
  const [state, setState] = useState<GpsState>({ status: 'idle', error: '' });
  useEffect(() => {
    if (!isDriver || !driver?.is_online) { stopDriverGps(); setState({ status: 'idle', error: '' }); return; }
    setState({ status: 'stale', error: 'Изчакване на потвърдена локация…' });
    startDriverGps(driver.id, driver.company_id, {
      onUpdate: () => setState({ status: 'tracking', error: '' }),
      onError: error => setState({ status: 'error', error }),
    });
    const timer = setInterval(() => {
      const stats = getGpsStats();
      if (stats.lastWriteAgeMs > GPS_STALE_MS) setState({ status: 'stale', error: stats.error || 'Локацията не се обновява. Провери GPS и интернета.' });
    }, 5000);
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    let acquiring = false;
    const wake = async () => {
      if (acquiring || lock || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      acquiring = true;
      try {
        const next = await navigator.wakeLock.request('screen');
        if (!alive) { await next.release(); return; }
        lock = next;
        next.addEventListener('release', () => { if (lock === next) lock = null; });
      } catch { /* The OS may deny Wake Lock; GPS health remains independently visible. */ }
      finally { acquiring = false; }
    };
    void wake(); document.addEventListener('visibilitychange', wake);
    return () => {
      alive = false; stopDriverGps(); clearInterval(timer);
      document.removeEventListener('visibilitychange', wake); void lock?.release();
    };
  }, [isDriver, user?.id, driver?.id, driver?.company_id, driver?.is_online]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
