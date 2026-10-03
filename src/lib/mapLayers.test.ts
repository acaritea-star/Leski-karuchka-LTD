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
