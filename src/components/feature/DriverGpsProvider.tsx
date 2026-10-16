import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocationPreference } from '@/hooks/useLocationPreference';
import { getLocationEnabled, setLocationEnabled } from '@/lib/locationPreference';
import { gpsPermission, getGpsPosition, requestGps, stopSharedGps } from '@/lib/sharedGps';
import { useAuth } from '@/hooks/useAuth';
import { isInBulgaria } from '@/lib/serviceArea';
import { driverRecordOptions } from '@/lib/driverRecord';
import { driverActiveRequestOptions } from '@/lib/driverActiveRequest';
import { ensureDriverLocation, startDriverGps, stopDriverGps, getGpsStats } from '@/lib/driverLocation';

type GpsState = { status: 'idle' | 'acquiring' | 'tracking' | 'stale' | 'error'; error: string; message?: string };
const Context = createContext<GpsState & { retryLocation: () => void; retrying: boolean }>({ status: 'idle', error: '', retryLocation: () => {}, retrying: false });
export const useDriverGps = () => useContext(Context);

export default function DriverGpsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const owner = useRef(user?.id); owner.current = user?.id;
  const locationEnabled = useLocationPreference(user?.id);
  const allowLocation = locationEnabled !== false;
  useEffect(() => () => { stopDriverGps(); stopSharedGps(); }, [user?.id]);
  const isDriver = user?.role === 'DRIVER';
  const { data: driver } = useQuery({
    ...driverRecordOptions(user?.id),
    enabled: isDriver, refetchInterval: isDriver ? 15_000 : false, refetchOnWindowFocus: true,
  });
  const { data: activeRequest } = useQuery({
    ...driverActiveRequestOptions(client, driver?.id),
    enabled: isDriver && !!driver?.id && !driver.is_online,
    // Offline idle drivers need one recovery read, not another polling loop.
    // The panels share this key and immediately publish ride transitions.
    refetchInterval: query => query.state.data ? 15_000 : false,
    staleTime: 5000,
  });
  const trackingRequired = !!driver && (driver.is_online || !!activeRequest
    && activeRequest.driver_id === driver.id && ['accepted', 'arrived', 'in_progress'].includes(activeRequest.status));
  const [state, setState] = useState<GpsState>({ status: 'idle', error: '' });
  const publishState = useCallback((next: GpsState) => setState(current => current.status === next.status
    && current.error === next.error && current.message === next.message ? current : next), []);
  const [retrying, setRetrying] = useState(false);
  const [permission, setPermission] = useState<Awaited<ReturnType<typeof gpsPermission>> | 'checking'>('checking');
  useEffect(() => {
    let active = true;
    const read = () => { void gpsPermission().then(value => { if (active) setPermission(value); }); };
    const resume = () => { if (document.visibilityState !== 'hidden') read(); };
    read(); window.addEventListener('focus', read); window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { active = false; window.removeEventListener('focus', read); window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume); };
    // Going Online may have just granted the native prompt. Recheck without
    // requesting permission again instead of retaining the pre-click state.
  }, [user?.id, trackingRequired]);
  useEffect(() => setRetrying(false), [user?.id]);
  // Offline drivers can center their map without sharing a working location.
  useEffect(() => {
    if (!isDriver || !user?.id || !driver?.id || trackingRequired || !allowLocation) return;
    let active = true;
    void gpsPermission().then(async permission => {
      if (!active || permission !== 'granted') return;
      const cached = getGpsPosition();
      const position = cached && Date.now() - cached.timestamp < 30_000 ? cached : await requestGps();
      if (!active || getLocationEnabled(user.id) === false) return;
      if (position.coords.accuracy <= 100 && isInBulgaria(position.coords.latitude, position.coords.longitude) && getLocationEnabled(user.id) === null) setLocationEnabled(user.id, true);
    }).catch(() => { /* Explicit GPS/Online actions display actionable errors. */ });
    return () => { active = false; };
  }, [isDriver, user?.id, driver?.id, trackingRequired, allowLocation]);

  useEffect(() => {
    if (!isDriver || !driver?.id || !trackingRequired || !allowLocation) { stopDriverGps(); setState({ status: 'idle', error: !allowLocation && trackingRequired ? 'Местоположението е изключено.' : '' }); return; }
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
  }, [isDriver, user?.id, driver?.id, driver?.company_id, trackingRequired, allowLocation, permission, publishState]);
  const retryLocation = useCallback(() => {
    if (!isDriver || !driver || !trackingRequired || !allowLocation || retrying) return;
    const startedOwner = user?.id;
    setRetrying(true);
    void ensureDriverLocation(driver, true, !!activeRequest).then(() => { if (owner.current === startedOwner) setPermission('granted'); }).catch(error => {
      if (owner.current === startedOwner) setState({status: 'error', error: error instanceof Error ? error.message : 'GPS още не е потвърден.'});
    }).finally(() => { if (owner.current === startedOwner) setRetrying(false); });
  }, [isDriver, driver, trackingRequired, activeRequest, allowLocation, retrying, user?.id]);
  const value = useMemo(() => ({ ...state, retryLocation, retrying }), [state, retryLocation, retrying]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
