/* global google */
import { useVehicleMarker } from '@/hooks/useVehicleMarker';
import { useRoadNetwork } from '@/hooks/useRoadNetwork';
import { useNearbyCars, type NearbyCar } from '@/hooks/useNearbyCars';
import type { RoadNetwork } from '@/lib/roadNetwork';
import type { RoutePoint } from '@/lib/googleMaps';
const EMPTY: RoutePoint[] = [];
function Car({map, car, roads}: {map: google.maps.Map; car: NearbyCar; roads: RoadNetwork | null}) {
  useVehicleMarker(map, car.fix, EMPTY, undefined, undefined, roads, true, 15_000);
  return null;
}
export default function NearbyCars({map, origin, owner, vehicleType}: {map: google.maps.Map; origin: RoutePoint | null; owner?: string; vehicleType?: string}) {
  const cars = useNearbyCars(origin, owner, vehicleType);
  const roads = useRoadNetwork(cars.length ? origin : null);
  return <>{cars.map(car => <Car key={car.token} map={map} car={car} roads={roads} />)}
    {cars.length > 0 && roads && <RoadAttribution />}</>;
}
export function RoadAttribution() {
  return <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
    className="absolute bottom-7 right-14 z-10 rounded bg-white/90 px-1 text-[9px] text-gray-600">© OpenStreetMap contributors</a>;
}
