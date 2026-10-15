import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocationPreference } from '@/hooks/useLocationPreference';
import { getLocationEnabled, setLocationEnabled } from '@/lib/locationPreference';
import { gpsPermission, getGpsPosition, requestGps, stopSharedGps } from '@/lib/sharedGps';
import { useAuth } from '@/hooks/useAuth';
import { isInBulgaria } from '@/lib/serviceArea';
import { driverRecordOptions } from '@/lib/driverRecord';
import { ensureDriverLocation, startDriverGps, stopDriverGps, getGpsStats } from '@/lib/driverLocation';

type GpsState = { status: 'idle' | 'acquiring' | 'tracking' | 'stale' | 'error'; error: string; message?: string };
const Context = createContext<GpsState & { retryLocation: () => void; retrying: boolean }>({ status: 'idle', error: '', retryLocation: () => {}, retrying: false });
export const useDriverGps = () => useContext(Context);

export default function DriverGpsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const owner = useRef(user?.id); owner.current = user?.id;
  const locationEnabled = useLocationPreference(user?.id);
  const allowLocation = locationEnabled !== false;
  useEffect(() => () => { stopDriverGps(); stopSharedGps(); }, [user?.id]);
  const isDriver = user?.role === 'DRIVER';
  const { data: driver } = useQuery({
    ...driverRecordOptions(user?.id),
    enabled: isDriver, refetchInterval: isDriver ? 15_000 : false, refetchOnWindowFocus: true,
  });
  const [state, setState] = useState<GpsState>({ status: 'idle', error: '' });
  const publishState = useCallback((next: GpsState) => setState(current => current.status === next.status
    && current.error === next.error && current.message === next.message ? current : next), []);
  const [retrying, setRetrying] = useState(false);
  const [permission, setPermission] = useState<Awaited<ReturnType<typeof gpsPermission>> | 'checking'>('checking');
  useEffect(() => {
    let active = true;
    const read = () => { void gpsPermission().then(value => { if (active) setPermission(value); }); };
    read(); window.addEventListener('focus', read);
    return () => { active = false; window.removeEventListener('focus', read); };
  }, [user?.id]);
  useEffect(() => setRetrying(false), [user?.id]);
  // Offline drivers can center their map without sharing a working location.
  useEffect(() => {
    if (!isDriver || !user?.id || !driver?.id || driver.is_online || !allowLocation) return;
    let active = true;
    void gpsPermission().then(async permission => {
      if (!active || permission !== 'granted') return;
      const cached = getGpsPosition();
      const position = cached && Date.now() - cached.timestamp < 30_000 ? cached : await requestGps();
      if (!active || getLocationEnabled(user.id) === false) return;
      if (position.coords.accuracy <= 100 && isInBulgaria(position.coords.latitude, position.coords.longitude) && getLocationEnabled(user.id) === null) setLocationEnabled(user.id, true);
    }).catch(() => { /* Explicit GPS/Online actions display actionable errors. */ });
    return () => { active = false; };
  }, [isDriver, user?.id, driver?.id, driver?.is_online, allowLocation]);

  useEffect(() => {
    if (!isDriver || !driver?.is_online || !allowLocation) { stopDriverGps(); setState({ status: 'idle', error: !allowLocation && driver?.is_online ? 'Местоположението е изключено.' : '' }); return; }
    if (permission !== 'granted') {
      stopDriverGps();
      if (permission === 'checking') { setState({ status: 'acquiring', error: '', message: 'Проверяваме разрешението за GPS…' }); return; }
      setState({ status: 'error', error: permission === 'denied' ? 'Разреши местоположението от настройките на браузъра.' : 'Натисни „Обнови GPS“, за да разрешиш местоположението.' });
      return;
    }
    let alive = true;
    let acquisitionDeadline = Date.now() + 24_000;
    const acquiringState = { status: 'acquiring', error: '', message: 'Уточняваме GPS. Новите заявки се отключват след потвърдена точна позиция.' } as const;
    publishState(acquiringState);
    startDriverGps(driver.id, driver.company_id, {
      onUpdate: () => {
        if (!alive) return;
        if (user?.id && getLocationEnabled(user.id) === null) setLocationEnabled(user.id, true);
        const stats = getGpsStats();
        const confirmed = stats.confirmed;
        if (confirmed) acquisitionDeadline = 0;
        publishState(confirmed ? { status: 'tracking', error: '' } : { status: 'stale', error: '', message: 'Изчакване на актуална локация…' });
      },
      onError: (error, recoverable) => {
        if (!alive) return;
        publishState(recoverable ? Date.now() < acquisitionDeadline ? acquiringState : { status: 'stale', error: '', message: error }
          : { status: 'error', error });
      },
    }, user?.id);
    const timer = setInterval(() => {
      const stats = getGpsStats();
      if (document.visibilityState === 'hidden') return;
      if (!stats.confirmed)
        setState(previous => {
          if (previous.status === 'error') return previous;
          const next: GpsState = Date.now() < acquisitionDeadline ? acquiringState
            : { status: 'stale', error: '', message: stats.error || 'Още няма потвърдена позиция. Обнови GPS и провери локацията на устройството.' };
          return previous.status === next.status && previous.error === next.error && previous.message === next.message ? previous : next;
        });
    }, 5000);
    const visibility = () => {
      const hidden = document.visibilityState === 'hidden';
      if (!hidden) acquisitionDeadline = Date.now() + 24_000;
      setState(previous => previous.status === 'error' ? previous : hidden
        ? { status: 'stale', error: '', message: 'GPS е паузиран, докато приложението е скрито. Отвори го отново за актуална позиция.' }
        : getGpsStats().confirmed ? { status: 'tracking', error: '' }
          : { ...acquiringState, message: 'Възстановяваме актуалната GPS позиция…' });
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pageshow', visibility);
    let lock: WakeLockSentinel | null = null;
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
    void wake(); document.addEventListener('visibilitychange', wake); window.addEventListener('pageshow', wake);
    return () => {
      alive = false; stopDriverGps(); clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pageshow', visibility);
      document.removeEventListener('visibilitychange', wake); window.removeEventListener('pageshow', wake); void lock?.release();
    };
  }, [isDriver, user?.id, driver?.id, driver?.company_id, driver?.is_online, allowLocation, permission, publishState]);
  const retryLocation = useCallback(() => {
    if (!isDriver || !driver?.is_online || !allowLocation || retrying) return;
    const startedOwner = user?.id;
    setRetrying(true);
    void ensureDriverLocation(driver, true).then(() => { if (owner.current === startedOwner) setPermission('granted'); }).catch(error => {
      if (owner.current === startedOwner) setState({status: 'error', error: error instanceof Error ? error.message : 'GPS още не е потвърден.'});
    }).finally(() => { if (owner.current === startedOwner) setRetrying(false); });
  }, [isDriver, driver, allowLocation, retrying, user?.id]);
  const value = useMemo(() => ({ ...state, retryLocation, retrying }), [state, retryLocation, retrying]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
