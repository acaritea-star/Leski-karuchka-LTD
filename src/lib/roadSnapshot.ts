import type { RoutePoint } from './googleMaps';
import { RoadNetwork, type RoadWay } from './roadNetwork';
import { withRequestTimeout } from './requestTimeout';
const snapshots = new Map<string, Promise<RoadNetwork | null>>();
const regions = [
  {path:'/roads/levski.json',south:43.325,north:43.375,west:25.095,east:25.165},
  {path:'/roads/veliko-tarnovo.json',south:43.045,north:43.105,west:25.565,east:25.655},
];
// Public, licensed street snapshots avoid community availability dependencies
// in supported towns. Each network loads once; other areas use the server cache.
export async function loadRoadSnapshot(point: RoutePoint): Promise<RoadNetwork | null> {
  const region = regions.find(r=>point.lat>=r.south&&point.lat<=r.north&&point.lng>=r.west&&point.lng<=r.east);
  if (!region) return null;
  let snapshot = snapshots.get(region.path);
  if (!snapshot) {
    snapshot = withRequestTimeout(async signal => {
      const response = await fetch(region.path, { signal });
      if (!response.ok) throw new Error('Road snapshot unavailable');
      const data = await response.json();
      if (!Array.isArray(data.roads) || !data.roads.length) throw new Error('Empty road snapshot');
      return new RoadNetwork(data.roads as RoadWay[]);
    }, 5000).catch(() => { snapshots.delete(region.path); return null; });
    snapshots.set(region.path, snapshot);
  }
  return snapshot;
}
