/* global google */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { frameMapPoints } from './mapCamera';
const panTo = vi.fn(), fitBounds = vi.fn();
const map = { panTo, fitBounds, getBounds: () => ({ getNorthEast: () => ({ lat: () => 2, lng: () => 2 }), getSouthWest: () => ({ lat: () => 0, lng: () => 0 }) }) } as unknown as google.maps.Map;
const size = { width: 1000, height: 1000 };
const padding = { top: 100, bottom: 100, left: 100, right: 100 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('google', { maps: { LatLngBounds: class { extend = vi.fn(); } } });
});
afterEach(() => vi.unstubAllGlobals());
it('does not move a camera that already shows the entire route outside overlays', () => {
  expect(frameMapPoints(map, [{ lat: .5, lng: .5 }, { lat: 1.5, lng: 1.5 }], size, padding)).toBe('none');
  expect(panTo).not.toHaveBeenCalled(); expect(fitBounds).not.toHaveBeenCalled();
});
it('pans to a nearby off-screen address while preserving scale and allowing for the panel', () => {
  const padded = { top: 200, bottom: 100, left: 500, right: 100 };
  expect(frameMapPoints(map, [{ lat: 1, lng: 3 }], size, padded)).toBe('pan');
  expect(panTo).toHaveBeenCalledWith({ lat: 1.1, lng: 2.6 });
  expect(fitBounds).not.toHaveBeenCalled();
});
it('fits a long route when keeping the current scale would hide an endpoint', () => {
  expect(frameMapPoints(map, [{ lat: 0, lng: 0 }, { lat: 3, lng: 3 }], size, padding)).toBe('fit');
  expect(fitBounds).toHaveBeenCalledOnce(); expect(panTo).not.toHaveBeenCalled();
});
it('uses native bounds fitting until the map has a usable viewport', () => {
  expect(frameMapPoints(map, [{ lat: 1, lng: 1 }], { width: 0, height: 0 }, padding)).toBe('fit');
  expect(fitBounds).toHaveBeenCalledOnce();
});
