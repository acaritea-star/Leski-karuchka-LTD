import type { RouteResult } from './googleMaps';
import { matchRoute, type MeasuredRoute } from './routeGeometry';
import { freshFix, type VehicleFix } from './vehicleMotion';

// Display-only estimate from confirmed GPS on the existing road. It never
// updates a fare, records kilometres, advances a trip status or calls an API.
export function remainingRouteEstimate(info: RouteResult | null, route: MeasuredRoute, fix: VehicleFix | null) {
  if (!info?.success || !freshFix(fix) || !fix) return null;
  if (info.distance_km === 0) return { ratio: 1, distanceKm: 0, durationMinutes: 0 };
  const match = matchRoute(fix, route);
  if (!match || route.length <= 0 || match.distance > Math.min(65, Math.max(35, (fix.accuracy ?? 20) * 1.5))) return null;
  const ratio = Math.max(0, Math.min(1, match.progress / route.length));
  return { ratio, distanceKm: Math.max(0, info.distance_km * (1 - ratio)),
    durationMinutes: Math.max(0, Math.ceil(info.duration_sec * (1 - ratio) / 60)) };
}
