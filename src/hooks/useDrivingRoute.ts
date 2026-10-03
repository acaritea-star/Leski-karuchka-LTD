import { useEffect, useRef, useState } from 'react';
import { computeRoute, decodePolyline, type RoutePoint, type RouteResult } from '@/lib/googleMaps';
import { distanceMetres, matchRoute, measureRoute, validPoint } from '@/lib/routeGeometry';
import { freshFix, type VehicleFix } from '@/lib/vehicleMotion';

type DrivingRoute = { info: RouteResult | null; path: RoutePoint[]; error: boolean };
const emptyRoute = (): DrivingRoute => ({ info: null, path: [], error: false });

// GPS updates must not cancel a route already being calculated. Only a target
// change/unmount invalidates its response. Refreshes use the latest real GPS.
export function useDrivingRoute(origin: VehicleFix | null, targetLat: number, targetLng: number): DrivingRoute {
  const [route, setRoute] = useState<DrivingRoute>(emptyRoute);
  const latestOrigin = useRef(origin);
  latestOrigin.current = origin;
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true, pending = false, nearTarget = false;
    let lastAttempt = 0;
    let lastOrigin: RoutePoint | null = null;
    let path: RoutePoint[] = [];
    const target = { lat: targetLat, lng: targetLng };
    setRoute(emptyRoute());
    const refresh = async () => {
      const fix = latestOrigin.current, now = Date.now();
      if (!active || document.visibilityState === 'hidden' || !freshFix(fix, now) || !fix || !validPoint(target)) return;
      // Co-located endpoints can legitimately have no road polyline. Do not
      // retry Google in a loop at the pin or change the request's trip status.
      if (distanceMetres(fix, target) <= 10 && (fix.accuracy ?? 0) <= 35) {
        if (!nearTarget) {
          nearTarget = true; path = [];
          setRoute({ info: { success: true, distance_km: 0, duration_min: 0, duration_sec: 0,
            polyline: '', legs: [], alternatives_count: 0 }, path, error: false });
        }
        return;
      }
      if (nearTarget) { nearTarget = false; lastOrigin = null; }
      if (pending) return;
      const moved = lastOrigin ? distanceMetres(lastOrigin, fix) : Infinity;
      const match = path.length ? matchRoute(fix, measureRoute(path)) : null;
      const offRoute = !!match && match.distance > 40;
      if (lastOrigin && now - lastAttempt < 10_000) return;
      if (path.length && moved < 3) return;
      if (path.length && moved < 120 && !offRoute && now - lastAttempt < 45_000) return;
      pending = true; lastAttempt = now; lastOrigin = { lat: fix.lat, lng: fix.lng };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          computeRoute(lastOrigin, target, { travelMode: 'DRIVE', language: 'bg', units: 'METRIC' }),
          new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 20_000); }),
        ]);
        if (!active || nearTarget) return;
        const decoded = result?.success && result.polyline ? measureRoute(decodePolyline(result.polyline)).points : [];
        if (result?.success && decoded.length >= 2) {
          path = decoded;
          setRoute({ info: result, path, error: false });
        } else setRoute(previous => ({ ...previous, error: true }));
      } catch {
        if (active) setRoute(previous => ({ ...previous, error: true }));
      } finally {
        if (timeout) clearTimeout(timeout);
        pending = false;
      }
    };
    const run = () => { void refresh(); };
    refreshRef.current = run;
    run();
    const timer = setInterval(run, 5000);
    document.addEventListener('visibilitychange', run);
    window.addEventListener('online', run);
    return () => {
      active = false;
      refreshRef.current = () => {};
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      window.removeEventListener('online', run);
    };
  }, [targetLat, targetLng]);

  useEffect(() => { refreshRef.current(); }, [origin]);
  return route;
}
