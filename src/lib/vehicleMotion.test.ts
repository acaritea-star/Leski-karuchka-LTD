import { describe, expect, it } from 'vitest';
import { VehicleMotion, freshFix, type VehicleFix } from './vehicleMotion';
import { distanceMetres, matchRoute, measureRoute, pointAlong, routeSection, shortestTurn } from './routeGeometry';

const a = { lat: 43, lng: 25 }, turn = { lat: 43.0005, lng: 25 }, b = { lat: 43.0005, lng: 25.0007 };
const path = [a, turn, b];
const fix = (point = a, timestamp = 1000, heading: number | null = null): VehicleFix =>
  ({ ...point, timestamp, heading, speed: 8, accuracy: 5 });

it('preserves a corner and clamps progress to the route, including reverse travel', () => {
  const route = measureRoute(path);
  expect(routeSection(route, 0, route.length)).toEqual(path);
  expect(routeSection(route, route.length, 0)).toEqual([...path].reverse());
  expect(pointAlong(route, -10)).toEqual(a);
  expect(pointAlong(route, route.length + 10)).toEqual(b);
});
it('chooses nearby progress at a crossing instead of jumping to a later loop', () => {
  const loop = measureRoute([a, turn, b, { lat: 43, lng: 25.0007 }, a, turn]);
  expect(matchRoute(a, loop, 1)?.progress).toBe(0);
  expect(matchRoute(a, loop, loop.metres[4] - 1)?.progress).toBeCloseTo(loop.metres[4]);
});
it('rejects invalid geometry and safely handles duplicate points', () => {
  expect(measureRoute([a, a, turn]).points).toEqual([a, turn]);
  expect(matchRoute(a, measureRoute([a]))).toBeNull();
  expect(measureRoute([a, { lat: NaN, lng: 0 }]).points).toEqual([]);
});

describe('vehicle presentation', () => {
  it('follows both sides of a corner rather than drawing a diagonal, and never overshoots', () => {
    const motion = new VehicleMotion(); motion.setRoute(path);
    motion.update(fix(), 1000); motion.update(fix(b, 6000), 6000);
    const half = motion.sample(8000)!;
    expect(half.lat).toBeGreaterThan(a.lat);
    expect(half.lat).toBeLessThan(turn.lat);
    expect(half.lng).toBeCloseTo(a.lng, 8); // Still on the north-bound street.
    const next = motion.sample(10_000)!;
    expect(next.lat).toBeCloseTo(turn.lat, 8);
    expect(next.lng).toBeGreaterThan(turn.lng);
    expect(motion.sample(11_000)).toMatchObject({ ...b, moving: false });
    expect(motion.sample(11_000)?.heading).toBeCloseTo(90, 1);
    expect(motion.sample(90_000)).toMatchObject({ ...b, moving: false });
  });
  it('heads back through the same corner when GPS shows reverse movement', () => {
    const motion = new VehicleMotion(); motion.setRoute(path);
    motion.update(fix(b), 1000); motion.update(fix(a, 6000), 6000);
    const sample = motion.sample(8000)!;
    expect(sample.lat).toBeCloseTo(turn.lat, 8);
    expect(sample.lng).toBeGreaterThan(a.lng);
    expect(motion.sample(11_000)?.heading).toBeCloseTo(180, 1);
  });
  it('retains north (0°) as a valid heading and rotates through the shorter angle', () => {
    const motion = new VehicleMotion();
    motion.update(fix(a, 1000, 359), 1000);
    motion.update(fix(turn, 6000, 0), 6000);
    expect(motion.sample(8500)?.heading).toBeCloseTo(359.5);
    expect(motion.sample(11000)?.heading).toBe(0);
    expect(shortestTurn(359, 1, .5)).toBe(0);
  });
  it('ignores duplicate heartbeats and out-of-order fixes without restarting movement', () => {
    const motion = new VehicleMotion();
    motion.update(fix(), 1000); motion.update(fix(turn, 6000), 6000);
    expect(motion.update({ ...fix(turn, 6000), receivedAt: 7000 }, 7000)).toBe(false);
    expect(motion.update(fix(b, 5000), 8000)).toBe(false);
    expect(motion.sample(11000)).toMatchObject({ ...turn, moving: false });
  });
  it('resynchronizes after a reconnect, a large jump or a reduced-motion preference', () => {
    for (const [timestamp, point, reduced] of [[40_000, turn, false], [6000, { lat: 43.02, lng: 25 }, false], [6000, turn, true]] as const) {
      const motion = new VehicleMotion(); motion.update(fix(), 1000);
      motion.update(fix(point, timestamp), timestamp, reduced);
      expect(motion.sample(timestamp)).toMatchObject({ ...point, moving: false });
    }
  });
  it('does not force a deviating car onto the planned road', () => {
    const off = { lat: 43.0005, lng: 25.002 };
    const motion = new VehicleMotion(); motion.setRoute(path);
    motion.update(fix(), 1000); motion.update(fix(off, 6000), 6000);
    expect(distanceMetres(motion.sample(11000)!, off)).toBeLessThan(.01);
  });
  it('does not animate an old fix and rejects inaccurate, future or impossible coordinates', () => {
    const motion = new VehicleMotion();
    expect(motion.update({ ...fix(), accuracy: 101 }, 1000)).toBe(false);
    expect(motion.update(fix({ lat: 95, lng: 25 }), 1000)).toBe(false);
    expect(motion.update(fix(a, 100_000), 1000)).toBe(false);
    expect(motion.sample(1000)).toBeNull();
    motion.update(fix(), 1000); motion.update(fix(turn, 6000), 60_000);
    expect(motion.sample(60000)).toMatchObject({ ...turn, moving: false });
  });
  it('settles on the last received point when the tab is hidden', () => {
    const motion = new VehicleMotion(); motion.setRoute(path);
    motion.update(fix(), 1000); motion.update(fix(b, 6000), 6000);
    expect(motion.settle()).toMatchObject({ ...b, moving: false });
    expect(motion.sample(100_000)).toMatchObject({ ...b, moving: false });
  });
  it('keeps the corner behind a refreshed route that starts ahead of the animated car', () => {
    const end = { lat: b.lat, lng: b.lng + .0005 };
    const motion = new VehicleMotion(); motion.setRoute([...path, end]);
    motion.update(fix(), 1000); motion.update(fix(b, 6000), 6000);
    motion.sample(7000);
    motion.setRoute([b, end]);
    motion.update(fix(end, 8000), 8000);
    const frame = motion.sample(8100)!;
    expect(frame.lng).toBeCloseTo(a.lng, 8);
    expect(frame.lat).toBeGreaterThan(a.lat);
    expect(motion.sample(10000)).toMatchObject(end);
  });
});
it('uses original GPS and server receipt times for freshness', () => {
  expect(freshFix(fix(a, 1000), 45_999)).toBe(true);
  expect(freshFix(fix(a, 1000), 46_000)).toBe(false);
  expect(freshFix({ ...fix(a, 45_000), receivedAt: 1000 }, 46_000)).toBe(false);
  expect(freshFix({ ...fix(a, 1000), accuracy: 500 }, 1000)).toBe(false);
});

it('shows a real GPS fix beyond the destination rather than hiding it at the end pin', () => {
  const motion = new VehicleMotion(); motion.setRoute(path);
  motion.update(fix(b, 1000), 1000);
  const beyond = { lat: b.lat, lng: b.lng + .001 };
  motion.update(fix(beyond, 6000), 6000);
  expect(motion.sample(11000)).toMatchObject({ ...beyond, moving: false });
  expect(motion.sample(90000)).toMatchObject({ ...beyond, moving: false });
});
