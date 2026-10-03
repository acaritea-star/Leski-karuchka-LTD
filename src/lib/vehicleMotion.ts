import { bearing } from './mapProjection';
import { distanceMetres, matchRoute, measureRoute, pointAlong, routeHeading, routeSection, shortestTurn, validPoint, type MeasuredRoute } from './routeGeometry';
import type { RoutePoint } from './googleMaps';

export const TRACKING_STALE_MS = 45_000;
export type VehicleFix = RoutePoint & { timestamp: number; receivedAt?: number; heading: number | null; speed: number | null; accuracy: number | null };
export type VehicleFrame = RoutePoint & { heading: number; moving: boolean };
type Transition = { path: MeasuredRoute; start: number; duration: number; fromHeading: number; toHeading: number; followsRoad: boolean };

export function validFix(fix: VehicleFix): boolean {
  return validPoint(fix) && Number.isFinite(fix.timestamp) &&
    (fix.accuracy == null || Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 100);
}
export function freshFix(fix: VehicleFix | null, now = Date.now()): boolean {
  return !!fix && validFix(fix) && fix.timestamp <= now + 30_000 && now - fix.timestamp < TRACKING_STALE_MS &&
    (fix.receivedAt == null || now - fix.receivedAt < TRACKING_STALE_MS);
}

// Animate towards a received fix. There is no extrapolation beyond that fix:
// distance travelled on screen never becomes a source of GPS/ETA/billing data.
export class VehicleMotion {
  private readonly animationWindowMs: number;
  constructor(animationWindowMs = 5000) { this.animationWindowMs = animationWindowMs; }
  private route = measureRoute([]);
  private confirmed: VehicleFix | null = null;
  private frame: VehicleFrame | null = null;
  private transition: Transition | null = null;
  private progress: number | undefined;
  private anchor: VehicleFix | null = null;

  setRoute(points: readonly RoutePoint[]) {
    const next = measureRoute(points);
    const current = this.frame ? matchRoute(this.frame, this.route, this.progress) : null;
    const join = next.points.length ? matchRoute(next.points[0], this.route, current?.progress) : null;
    const sameTarget = next.points.length >= 2 && this.route.points.length >= 2 &&
      distanceMetres(next.points.at(-1)!, this.route.points.at(-1)!) < 10;
    // A refresh starts at the latest GPS, ahead of the interpolated car. Keep
    // the short known road behind that origin so the next fix still goes around
    // its corners, instead of drawing a chord from outside the new route.
    this.route = sameTarget && current && join && current.distance <= 35 && join.distance <= 35 && join.progress >= current.progress
      ? measureRoute([...routeSection(this.route, current.progress, join.progress), ...next.points]) : next;
    this.progress = undefined;
  }

  update(fix: VehicleFix, now = Date.now(), reducedMotion = false): boolean {
    if (!validFix(fix) || fix.timestamp > now + 30_000 ||
      this.confirmed && fix.timestamp <= this.confirmed.timestamp) return false;
    const previous = this.confirmed;
    const previousProgress = this.progress;
    const current = this.sample(now);
    const snapLimit = Math.min(65, Math.max(25, (fix.accuracy ?? 10) * 1.5));
    const end = matchRoute(fix, this.route, this.progress);
    const onRoad = !!end && end.distance <= snapLimit;
    const point = onRoad ? end.point : { lat: fix.lat, lng: fix.lng };
    const movement = current ? distanceMetres(current, point) : 0;
    const roadHeading = onRoad ? (routeHeading(this.route, end.progress) +
      (previousProgress != null && end.progress < previousProgress ? 180 : 0)) % 360 : null;
    const heading = roadHeading ?? (typeof fix.heading === 'number' && Number.isFinite(fix.heading) && fix.heading >= 0
      ? fix.heading % 360 : roadHeading ?? (current && movement > 1
        ? bearing(current.lat, current.lng, point.lat, point.lng) : current?.heading ?? 0));
    const gap = previous ? fix.timestamp - previous.timestamp : Infinity;
    this.confirmed = { ...fix };
    const drift = this.anchor ? distanceMetres(this.anchor, fix) : Infinity;
    const idle = !!current && drift < Math.min(15, Math.max(4, (fix.accuracy ?? 10) * .6)) && (fix.speed == null || fix.speed < 1.5);
    const backwardsJitter = !!current && onRoad && previousProgress != null && end.progress < previousProgress && previousProgress-end.progress < 12 && (fix.speed == null || fix.speed < 1.5);
    if (idle || backwardsJitter) {
      // GPS/course noise at a stop never rotates or walks the icon into a building.
      this.frame = { ...(this.transition ? this.settle()! : current!), moving: false }; this.transition = null;
      return true;
    }
    this.anchor = { ...fix };
    this.progress = onRoad ? end.progress : undefined;

    // Resync on first fix, reconnect, large jump or reduced motion. Do not
    // replay an unobserved trip after a long gap or sweep across a whole town.
    if (!current || reducedMotion || !freshFix(fix, now) || gap > 20_000 || movement > 300) {
      this.frame = { ...point, heading, moving: false };
      this.transition = null;
      return true;
    }
    if (movement < 0.7) {
      this.transition = null;
      this.frame = { ...point, heading: current.heading, moving: false };
      return true;
    }
    const from = matchRoute(current, this.route, previousProgress);
    const followsRoad = onRoad && !!from && from.distance <= snapLimit &&
      Math.abs(end.progress - from.progress) <= Math.max(60, movement * 2.5);
    const vertices = followsRoad
      ? routeSection(this.route, from!.progress, end.progress) : [current, point];
    const path = measureRoute(vertices);
    this.transition = { path, start: now, duration: Math.min(this.animationWindowMs, Math.max(300, gap), TRACKING_STALE_MS - (now - fix.timestamp)),
      fromHeading: current.heading, toHeading: heading, followsRoad };
    return true;
  }

  sample(now = Date.now()): VehicleFrame | null {
    const transition = this.transition;
    if (!transition) return this.frame;
    const fraction = Math.min(1, Math.max(0, (now - transition.start) / transition.duration));
    const point = pointAlong(transition.path, transition.path.length * fraction);
    const heading = transition.followsRoad && fraction < 1
      ? routeHeading(transition.path, transition.path.length * fraction)
      : shortestTurn(transition.fromHeading, transition.toHeading, fraction);
    this.frame = { ...point, heading, moving: fraction < 1 };
    if (fraction === 1) this.transition = null;
    return this.frame;
  }

  settle(): VehicleFrame | null {
    return this.sample(Number.MAX_SAFE_INTEGER);
  }
}
