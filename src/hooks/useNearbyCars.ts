import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RoutePoint } from '@/lib/googleMaps';
import { isInBulgaria } from '@/lib/serviceArea';
import { freshFix, type VehicleFix } from '@/lib/vehicleMotion';
import { driverPosition } from './useDriverPosition';
import { withRequestTimeout } from '@/lib/requestTimeout';
export type NearbyCar = { token: string; fix: VehicleFix };
export function parseNearbyCars(data: unknown): NearbyCar[] {
  if (!data || typeof data !== 'object' || !('cars' in data) || !Array.isArray(data.cars)) return [];
  const seen = new Set<string>();
  return data.cars.slice(0, 12).flatMap(row => {
    if (!row || typeof row !== 'object' || typeof row.token !== 'string' || !/^[a-f0-9]{32}$/.test(row.token) || seen.has(row.token)) return [];
    const fix = driverPosition({ ...row, latitude: row.lat, longitude: row.lng });
    if (!freshFix(fix) || !fix || !isInBulgaria(fix.lat, fix.lng)) return [];
    seen.add(row.token); return [{ token: row.token, fix }];
  });
}
const EMPTY: NearbyCar[] = [];
export function useNearbyCars(origin: RoutePoint | null, owner: string | undefined, vehicleType?: string): NearbyCar[] {
  const latest = useRef(origin); latest.current = origin;
  const runRef = useRef<() => void>(() => {});
  const key = owner ? `${owner}:${vehicleType ?? ''}` : '';
  const [snapshot, setSnapshot] = useState<{ key: string; cars: NearbyCar[] }>({ key: '', cars: EMPTY });
  useEffect(() => {
    if (!owner) return;
    let active = true, pending = false, lastAttempt: number | null = null, nextAttempt = 0, failures = 0;
    const controller = new AbortController();
    const poll = async () => {
      const point = latest.current, now = Date.now();
      if (!active || pending || now < nextAttempt || document.visibilityState === 'hidden' || !point || !isInBulgaria(point.lat, point.lng) || lastAttempt !== null && now-lastAttempt < 15_000) return;
      pending = true; lastAttempt = now;
      try {
        const {data, error} = await withRequestTimeout(signal => supabase.rpc('nearby_cars', { p_lat: point.lat, p_lng: point.lng, ...(vehicleType ? {p_type: vehicleType} : {}) }).abortSignal(signal), 10_000, controller.signal);
        if (error) throw error;
        failures = 0; nextAttempt = 0;
        if (active) setSnapshot({key, cars: parseNearbyCars(data)});
      } catch { nextAttempt = Date.now() + Math.min(60_000, 15_000 * 2 ** Math.min(failures++, 2)); }
      finally { pending = false; }
    };
    const run = () => { void poll(); };
    const resume = () => { if (document.visibilityState !== 'hidden') { nextAttempt = 0; run(); } };
    runRef.current = run; run();
    const timer = setInterval(run, 15_000);
    const expiry = setInterval(() => {
      setSnapshot(previous => {
        const cars = previous.cars.filter(car => freshFix(car.fix));
        return cars.length === previous.cars.length ? previous : {...previous, cars};
      });
    }, 1000);
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume); window.addEventListener('pageshow', resume);
    return () => { active = false; controller.abort(); runRef.current = () => {}; clearInterval(timer); clearInterval(expiry); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('pageshow', resume); };
  }, [owner, vehicleType, key]);
  useEffect(() => { runRef.current(); }, [origin]);
  return origin && isInBulgaria(origin.lat, origin.lng) && snapshot.key === key ? snapshot.cars : EMPTY;
}
