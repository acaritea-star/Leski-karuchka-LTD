import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocationPreference } from '@/hooks/useLocationPreference';
import { getLocationEnabled, setLocationEnabled } from '@/lib/locationPreference';
import { gpsPermission, getGpsPosition, requestGps, stopSharedGps } from '@/lib/sharedGps';
import { useAuth } from '@/hooks/useAuth';
import { isInBulgaria } from '@/lib/serviceArea';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';
import { startDriverGps, stopDriverGps, getGpsStats, GPS_STALE_MS } from '@/lib/driverLocation';

type GpsState = { status: 'idle' | 'tracking' | 'stale' | 'error'; error: string };
const Context = createContext<GpsState>({ status: 'idle', error: '' });
export const useDriverGps = () => useContext(Context);

export default function DriverGpsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const locationEnabled = useLocationPreference(user?.id);
  const allowLocation = locationEnabled !== false;
  useEffect(() => () => { stopDriverGps(); stopSharedGps(); }, [user?.id]);
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
  // Offline drivers can center their map without sharing a working location.
  useEffect(() => {
    if (!isDriver || !user?.id || !driver?.id || driver.is_online || !allowLocation) return;
    let active = true;
    void gpsPermission().then(async permission => {
      if (!active || permission === 'denied' || (permission !== 'granted' && getLocationEnabled(user.id) !== true)) return;
      const cached = getGpsPosition();
      const position = cached && Date.now() - cached.timestamp < 30_000 ? cached : await requestGps();
      if (!active || getLocationEnabled(user.id) === false) return;
      if (position.coords.accuracy <= 100 && isInBulgaria(position.coords.latitude, position.coords.longitude) && getLocationEnabled(user.id) === null) setLocationEnabled(user.id, true);
    }).catch(() => { /* Explicit GPS/Online actions display actionable errors. */ });
    return () => { active = false; };
  }, [isDriver, user?.id, driver?.id, driver?.is_online, allowLocation]);

  useEffect(() => {
    if (!isDriver || !driver?.is_online || !allowLocation) { stopDriverGps(); setState({ status: 'idle', error: !allowLocation && driver?.is_online ? 'Местоположението е изключено.' : '' }); return; }
    setState({ status: 'stale', error: 'Изчакване на потвърдена локация…' });
    startDriverGps(driver.id, driver.company_id, {
      onUpdate: () => {
        if (user?.id && getLocationEnabled(user.id) === null) setLocationEnabled(user.id, true);
        setState({ status: 'tracking', error: '' });
      },
      onError: error => setState({ status: 'error', error }),
    }, user?.id);
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
  }, [isDriver, user?.id, driver?.id, driver?.company_id, driver?.is_online, allowLocation]);
  return <Context.Provider value={state}>{children}</Context.Provider>;
}
