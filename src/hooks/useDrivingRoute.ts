import { useEffect, useRef, useState } from 'react';
import { computeRoute, decodePolyline, type RoutePoint, type RouteResult } from '@/lib/googleMaps';
import { distanceMetres, matchRoute, measureRoute, validPoint } from '@/lib/routeGeometry';
import { freshFix, type VehicleFix } from '@/lib/vehicleMotion';

type DrivingRoute = { info: RouteResult | null; path: RoutePoint[]; error: boolean; blocked: boolean };
const emptyRoute = (): DrivingRoute => ({ info: null, path: [], error: false, blocked: false });
type RouteScope = { requestId?: string; purpose?: 'pickup' | 'destination' };
const MAX_ATTEMPTS_PER_LEG = 3;

// GPS updates must not cancel a route already being calculated. Only a target
// change/unmount invalidates its response. Refreshes use the latest real GPS.
export function useDrivingRoute(origin: VehicleFix | null, targetLat: number, targetLng: number, scope: RouteScope = {}): DrivingRoute {
  const [route, setRoute] = useState<DrivingRoute>(emptyRoute);
  const latestOrigin = useRef(origin);
  latestOrigin.current = origin;
  const refreshRef = useRef<() => void>(() => {});
  const { requestId, purpose } = scope;

  useEffect(() => {
    let active = true, pending = false, nearTarget = false;
    let attempts = 0, failures = 0, nextAttemptAt = 0;
    let examinedAt = -Infinity, offSince: number | null = null, offSamples = 0;
    let progress: number | undefined;
    let path: RoutePoint[] = [];
    let measured = measureRoute(path);
    let sourceInfo: RouteResult | null = null;
    const target = { lat: targetLat, lng: targetLng };
    setRoute(emptyRoute());
    const refresh = async () => {
      const fix = latestOrigin.current, now = Date.now();
      if (!active || document.visibilityState === 'hidden' || !freshFix(fix, now) || !fix || !validPoint(target)) return;
      // Co-located endpoints can legitimately have no road polyline. Do not
      // retry Google in a loop at the pin or change the request's trip status.
      if (distanceMetres(fix, target) <= 10 && (fix.accuracy ?? 0) <= 35) {
        if (!nearTarget) {
          nearTarget = true;
          setRoute({ info: { success: true, distance_km: 0, duration_min: 0, duration_sec: 0,
            polyline: '', legs: [], alternatives_count: 0 }, path, error: false, blocked: false });
        }
        return;
      }
      if (nearTarget) {
        nearTarget = false; offSince = null; offSamples = 0;
        if (sourceInfo) setRoute(previous => ({ ...previous, info: sourceInfo }));
      }
      if (pending) return;
      const match = matchRoute(fix, measured, progress);
      // Neither distance travelled nor elapsed time is a reason to buy another
      // route. Require independent, accurate fixes off the known road instead.
      if (match) {
        if (fix.timestamp > examinedAt) {
          if (fix.timestamp - examinedAt > 20_000) { offSince = null; offSamples = 0; }
          examinedAt = fix.timestamp;
          if (match.distance > Math.max(50, (fix.accuracy ?? 50) * 2) && (fix.accuracy ?? 50) <= 50) {
            offSince ??= now; offSamples++;
          } else {
            offSince = null; offSamples = 0; progress = match.progress;
            setRoute(previous => previous.error && !previous.blocked ? { ...previous, error: false } : previous);
          }
        }
        if (offSamples < 3 || offSince == null || now - offSince < 10_000) return;
        setRoute(previous => previous.error ? previous : { ...previous, error: true });
      }
      if (now < nextAttemptAt) return;
      if (attempts >= MAX_ATTEMPTS_PER_LEG) {
        setRoute(previous => previous.blocked ? previous : { ...previous, error: true, blocked: true });
        return;
      }
      pending = true; attempts++;
      const routeOrigin = { lat: fix.lat, lng: fix.lng };
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          computeRoute(routeOrigin, target, { travelMode: 'DRIVE', language: 'bg', units: 'METRIC', requestId, purpose }),
          new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 20_000); }),
        ]);
        if (!active || nearTarget) return;
        const decoded = result?.success && result.polyline ? measureRoute(decodePolyline(result.polyline)).points : [];
        if (result?.success && decoded.length >= 2) {
          path = decoded; measured = measureRoute(path); sourceInfo = result; progress = undefined;
          examinedAt = -Infinity; offSince = null; offSamples = 0; failures = 0;
          nextAttemptAt = Date.now() + 30_000;
          setRoute({ info: result, path, error: false, blocked: false });
        } else {
          failures++;
          const denied = !!result?.status && result.status >= 400 && result.status < 500 && result.status !== 429;
          nextAttemptAt = denied ? Infinity : Date.now() + Math.max(failures === 1 ? 10_000 : 30_000, (result?.retry_after_sec ?? 0) * 1000);
          setRoute(previous => ({ ...previous, error: true, blocked: denied || attempts >= MAX_ATTEMPTS_PER_LEG }));
        }
      } catch {
        failures++; nextAttemptAt = Date.now() + (failures === 1 ? 10_000 : 30_000);
        if (active) setRoute(previous => ({ ...previous, error: true, blocked: attempts >= MAX_ATTEMPTS_PER_LEG }));
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
  }, [targetLat, targetLng, requestId, purpose]);

  useEffect(() => { refreshRef.current(); }, [origin]);
  return route;
}
