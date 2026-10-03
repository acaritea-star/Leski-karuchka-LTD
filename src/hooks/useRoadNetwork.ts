import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { loadRoadSnapshot } from '@/lib/roadSnapshot';
import { RoadNetwork, type RoadWay } from '@/lib/roadNetwork';
import type { RoutePoint } from '@/lib/googleMaps';
import { isInBulgaria } from '@/lib/serviceArea';
const cache = new Map<string, Promise<RoadNetwork | null>>();
export function useRoadNetwork(point: RoutePoint | null) {
  const latest = useRef(point); latest.current = point;
  const key = point && isInBulgaria(point.lat, point.lng) ? `${Math.floor(point.lat/.02)}:${Math.floor(point.lng/.02)}` : '';
  const [value, setValue] = useState<{key: string; network: RoadNetwork | null}>({key: '', network: null});
  useEffect(() => {
    if (!key) return;
    let active = true, attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (document.visibilityState === 'hidden') { timer = setTimeout(() => { void load(); }, 60_000); return; }
      let pending = cache.get(key);
      if (!pending && latest.current) {
        const origin = latest.current;
        pending = loadRoadSnapshot(origin).then(async snapshot => {
          if (snapshot) return snapshot;
          const {data, error} = await supabase.functions.invoke('road-geometry', {body: {lat: origin.lat, lng: origin.lng}});
          if (error || !Array.isArray(data?.roads) || !data.roads.length) { cache.delete(key); return null; }
          return new RoadNetwork(data.roads as RoadWay[]);
        }).catch(() => { cache.delete(key); return null; });
        cache.set(key, pending);
        if (cache.size > 4) cache.delete(cache.keys().next().value!);
      }
      const network = pending ? await pending : null;
      if (!active) return;
      setValue({key, network});
      if (!network && ++attempts < 3) timer = setTimeout(() => { void load(); }, 65_000);
    };
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [key]);
  return value.key === key ? value.network : null;
}
