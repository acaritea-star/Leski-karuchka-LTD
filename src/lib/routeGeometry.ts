import { calculateDistance } from './geo';
import { bearing } from './mapProjection';
import type { RoutePoint } from './googleMaps';

export type MeasuredRoute = { points: RoutePoint[]; metres: number[]; length: number };
export type RouteMatch = { point: RoutePoint; distance: number; progress: number; segment: number };

export const distanceMetres = (a: RoutePoint, b: RoutePoint) => calculateDistance(a.lat, a.lng, b.lat, b.lng) * 1000;
export function validPoint(point: RoutePoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

export function measureRoute(points: readonly RoutePoint[]): MeasuredRoute {
  const clean: RoutePoint[] = [];
  for (const point of points) {
    if (!validPoint(point)) return { points: [], metres: [], length: 0 };
    if (!clean.length || distanceMetres(clean[clean.length - 1], point) > 0.01) clean.push({ ...point });
  }
  const metres = clean.length ? [0] : [];
  for (let i = 1; i < clean.length; i++) metres.push(metres[i - 1] + distanceMetres(clean[i - 1], clean[i]));
  return { points: clean, metres, length: metres.at(-1) ?? 0 };
}

export function pointAlong(route: MeasuredRoute, progress: number): RoutePoint {
  const { points, metres, length } = route;
  if (!points.length) throw new Error('Empty route');
  const at = Math.max(0, Math.min(length, progress));
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (metres[mid] < at) lo = mid + 1; else hi = mid;
  }
  if (!lo) return { ...points[0] };
  const ratio = (at - metres[lo - 1]) / (metres[lo] - metres[lo - 1]);
  return { lat: points[lo - 1].lat + (points[lo].lat - points[lo - 1].lat) * ratio,
    lng: points[lo - 1].lng + (points[lo].lng - points[lo - 1].lng) * ratio };
}

// This is local matching to the calculated route, not a paid Roads API call.
// Prefer nearby progress at crossings to avoid jumping to a later loop.
export function matchRoute(point: RoutePoint, route: MeasuredRoute, preferredProgress?: number): RouteMatch | null {
  if (!validPoint(point) || route.points.length < 2) return null;
  const candidates: RouteMatch[] = [];
  let nearest = Infinity;
  for (let i = 0; i < route.points.length - 1; i++) {
    const a = route.points[i], b = route.points[i + 1];
    const cos = Math.cos((point.lat + a.lat + b.lat) / 3 * Math.PI / 180);
    const dx = (b.lng - a.lng) * cos, dy = b.lat - a.lat;
    const t = Math.max(0, Math.min(1, ((point.lng - a.lng) * cos * dx + (point.lat - a.lat) * dy) / (dx * dx + dy * dy)));
    const projection = { lat: a.lat + dy * t, lng: a.lng + (b.lng - a.lng) * t };
    const distance = distanceMetres(point, projection);
    nearest = Math.min(nearest, distance);
    candidates.push({ point: projection, distance, segment: i,
      progress: route.metres[i] + (route.metres[i + 1] - route.metres[i]) * t });
  }
  const nearby = candidates.filter(candidate => candidate.distance <= nearest + 5);
  nearby.sort((a, b) => preferredProgress == null ? a.distance - b.distance
    : a.distance + Math.min(12, Math.abs(a.progress - preferredProgress) * 0.1)
      - b.distance - Math.min(12, Math.abs(b.progress - preferredProgress) * 0.1));
  return nearby[0];
}

export function routeSection(route: MeasuredRoute, from: number, to: number): RoutePoint[] {
  const low = Math.min(from, to), high = Math.max(from, to);
  const middle = route.points.filter((_, i) => route.metres[i] > low && route.metres[i] < high);
  if (to < from) middle.reverse();
  return [pointAlong(route, from), ...middle, pointAlong(route, to)];
}

export function routeHeading(route: MeasuredRoute, progress: number): number {
  const a = pointAlong(route, Math.max(0, progress - 2));
  const b = pointAlong(route, Math.min(route.length, progress + 3));
  return distanceMetres(a, b) < 0.01 ? 0 : bearing(a.lat, a.lng, b.lat, b.lng);
}

export function remainingRoute(points: readonly RoutePoint[], position: RoutePoint | null): RoutePoint[] {
  if (!position || points.length < 2) return [...points];
  const route = measureRoute(points), match = matchRoute(position, route);
  return match && match.distance <= 35 ? routeSection(route, match.progress, route.length) : [...points];
}

export function shortestTurn(from: number, to: number, fraction: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * fraction + 360) % 360;
}
