import type { RoutePoint } from './googleMaps';
import { RoadNetwork, type RoadWay } from './roadNetwork';
let snapshot: Promise<RoadNetwork | null> | null = null;
// A small, openly licensed town snapshot avoids community availability/cost
// dependencies in the initial service area. Other Bulgarian areas use the cache.
export async function loadRoadSnapshot(point: RoutePoint): Promise<RoadNetwork | null> {
  if (point.lat < 43.325 || point.lat > 43.375 || point.lng < 25.095 || point.lng > 25.165) return null;
  if (!snapshot) snapshot = fetch('/roads/levski.json', {signal: AbortSignal.timeout(5000)}).then(async response => {
    if (!response.ok) throw new Error('Road snapshot unavailable');
    const data = await response.json();
    if (!Array.isArray(data.roads) || !data.roads.length) throw new Error('Empty road snapshot');
    return new RoadNetwork(data.roads as RoadWay[]);
  }).catch(() => { snapshot = null; return null; });
  return snapshot;
}
