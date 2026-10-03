import { afterEach, expect, it, vi } from 'vitest';
import { drawRouteLine, updateRouteLayer } from './mapLayers';
import { measureRoute, pointAlong } from './routeGeometry';
const a = { lat: 43, lng: 25 }, b = { lat: 43.001, lng: 25 };
afterEach(() => vi.unstubAllGlobals());
it('bounds live route redraws while following forward and reverse GPS movement', () => {
  const setPath = vi.fn();
  vi.stubGlobal('google', { maps: { Polyline: class { setPath = setPath; setMap = vi.fn(); }, SymbolPath: { FORWARD_CLOSED_ARROW: 1 } } });
  let time = 0;
  vi.stubGlobal('performance', { now: () => time });
  const road = drawRouteLine({} as never, [a, b]);
  const route = measureRoute([a, b]);
  for (time = 0; time < 1000; time += 16) road.follow(pointAlong(route, route.length * time / 1000));
  expect(setPath.mock.calls.length).toBeLessThanOrEqual(20); // Two layers, <= ten updates each.
  expect(setPath.mock.calls.length).toBeGreaterThan(2);
  time = 1200; road.follow(a);
  expect(setPath.mock.calls.at(-1)?.[0][0]).toEqual(a);
});

it('reuses road layers and updates the measured geometry on a reroute', () => {
  const setPath = vi.fn(), setMap = vi.fn();
  const create = vi.fn(function () { return { setPath, setMap }; });
  vi.stubGlobal('google', { maps: { Polyline: create, SymbolPath: { FORWARD_CLOSED_ARROW: 1 } } });
  vi.stubGlobal('performance', { now: () => 1000 });
  const map = {} as never;
  let layer = updateRouteLayer(null, map, [a, b]);
  const next = [{ lat: 44, lng: 26 }, { lat: 44.002, lng: 26 }];
  layer = updateRouteLayer(layer, map, next);
  expect(create).toHaveBeenCalledTimes(2);
  expect(setMap).not.toHaveBeenCalled();
  layer?.line.follow({ lat: 44.001, lng: 26 });
  expect(setPath.mock.calls.at(-1)?.[0][0]).toEqual({ lat: 44.001, lng: 26 });
  expect(setPath.mock.calls.at(-1)?.[0].at(-1)).toEqual(next[1]);
  updateRouteLayer(layer, map, []);
  expect(setMap).toHaveBeenCalledTimes(2);
});

function incrementalMaps() {
  const records: Array<{ path: Array<{ lat: number; lng: number }>; whole: number; heads: number }> = [];
  class LatLng {
    latitude: number; longitude: number;
    constructor(latitude: number, longitude: number) { this.latitude = latitude; this.longitude = longitude; }
    lat() { return this.latitude; }
    lng() { return this.longitude; }
  }
  class Polyline {
    record: typeof records[number];
    constructor(options: { path: typeof a[] }) {
      this.record = { path: [...options.path], whole: 0, heads: 0 }; records.push(this.record);
    }
    setPath(path: typeof a[]) { this.record.path = [...path]; this.record.whole++; }
    getPath() { return { setAt: (index: number, point: LatLng) => {
      this.record.path[index] = { lat: point.lat(), lng: point.lng() }; this.record.heads++;
    } }; }
    setMap() {}
  }
  vi.stubGlobal('google', { maps: { Polyline, LatLng, SymbolPath: { FORWARD_CLOSED_ARROW: 1 } } });
  return records;
}
it('updates only two head vertices while moving along a segment of a long route', () => {
  const records = incrementalMaps();
  let time = 0; vi.stubGlobal('performance', { now: () => time });
  const path = [a, { lat: 43.01, lng: 25 }, ...Array.from({ length: 998 }, (_, i) => ({ lat: 43.01, lng: 25 + .00001 * (i + 1) }))];
  const road = drawRouteLine({} as never, path);
  for (let i = 0; i < 20; i++) { time += 110; road.follow({ lat: 43 + i * .00001, lng: 25 }); }
  expect(records.map(record => record.whole)).toEqual([1, 1]);
  expect(records.map(record => record.heads)).toEqual([19, 19]);
  expect(records[0].path).toHaveLength(1000);
  expect(records[0].path.at(-1)).toEqual(path.at(-1));
});
it('restores a corner vertex when the car reverses after reaching it', () => {
  const records = incrementalMaps();
  let time = 0; vi.stubGlobal('performance', { now: () => time });
  const end = { lat: b.lat, lng: b.lng + .001 };
  const road = drawRouteLine({} as never, [a, b, end]);
  road.follow(b);
  time += 110; road.follow({ lat: b.lat - .0001, lng: b.lng });
  expect(records[0].path[1]).toEqual(b);
  expect(records[0].path.at(-1)).toEqual(end);
  expect(records[0].whole).toBe(2);
});
