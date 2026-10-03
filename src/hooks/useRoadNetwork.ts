import { useEffect, useRef, useState } from 'react';
import { loadRoadSnapshot } from '@/lib/roadSnapshot';
import { RoadNetwork, type RoadWay } from '@/lib/roadNetwork';
import type { RoutePoint } from '@/lib/googleMaps';
import { isInBulgaria } from '@/lib/serviceArea';
import { invokeEdge } from '@/lib/edgeRequest';
const cache = new Map<string, Promise<RoadNetwork | null>>();
const failedUntil = new Map<string, number>();
export function useRoadNetwork(point: RoutePoint | null) {
  const latest = useRef(point); latest.current = point;
  const key = point && isInBulgaria(point.lat, point.lng) ? `${Math.floor(point.lat/.02)}:${Math.floor(point.lng/.02)}` : '';
  const [value, setValue] = useState<{key: string; network: RoadNetwork | null}>({key: '', network: null});
  useEffect(() => {
    if (!key) return;
    let active = true, loading = false, attempts = 0, lastAttempt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (!active || loading) return;
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => { void load(); }, 60_000); return; }
      loading = true; lastAttempt = Date.now();
      let pending = cache.get(key);
      if (Date.now() >= (failedUntil.get(key) ?? Infinity)) {
        cache.delete(key); failedUntil.delete(key); pending = undefined;
      }
      if (!pending && latest.current) {
        const origin = latest.current;
        pending = loadRoadSnapshot(origin).then(async snapshot => {
          if (snapshot) return snapshot;
          const {data, error} = await invokeEdge<{ roads: RoadWay[] }>('road-geometry', {lat: origin.lat, lng: origin.lng}, 20_000);
          if (error || !Array.isArray(data?.roads) || !data.roads.length) {
            if (cache.get(key) === pending) failedUntil.set(key, Date.now() + 65_000);
            return null;
          }
          return new RoadNetwork(data.roads as RoadWay[]);
        }).catch(() => { if (cache.get(key) === pending) failedUntil.set(key, Date.now() + 65_000); return null; });
        cache.set(key, pending);
        if (cache.size > 4) { const oldest = cache.keys().next().value!; cache.delete(oldest); failedUntil.delete(oldest); }
      }
      const network = pending ? await pending : null;
      loading = false;
      if (!active) return;
      setValue({key, network});
      if (!network && ++attempts < 3) timer = setTimeout(() => { void load(); }, 65_000);
    };
    const resume = () => {
      if (!active || loading || attempts >= 3 || document.visibilityState === 'hidden' || Date.now() - lastAttempt < 65_000) return;
      if (timer) clearTimeout(timer);
      void load();
    };
    void load();
    document.addEventListener('visibilitychange', resume); window.addEventListener('pageshow', resume); window.addEventListener('online', resume);
    return () => { active = false; if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pageshow', resume); window.removeEventListener('online', resume); };
  }, [key]);
  return value.key === key ? value.network : null;
}
