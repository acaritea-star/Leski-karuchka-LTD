// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import DriverRouteMap from './DriverRouteMap';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { computeRoute, type RouteResult } from '@/lib/googleMaps';
import { CAR_PATH } from '@/lib/mapLayers';
vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: vi.fn() }));
vi.mock('@/lib/googleMaps', () => ({ computeRoute: vi.fn(), decodePolyline: () => [{ lat: 43, lng: 25 }, { lat: 43.005, lng: 25 }] }));
vi.mock('@/hooks/useDriverPosition', async importOriginal => ({ ...await importOriginal<typeof import('@/hooks/useDriverPosition')>(), useDriverPosition: () => null }));
const setMap = vi.fn(), setPath = vi.fn();
const marker = vi.fn(function () { return { setMap, setPosition: vi.fn(), setIcon: vi.fn() }; });
const polyline = vi.fn(function () { return { setMap, setPath }; });
const result: RouteResult = { success: true, polyline: 'road', distance_km: .56, duration_min: 3, duration_sec: 180,
  legs: [{ steps: [{ instruction: 'Продължете направо', distance_meters: 400 }, { instruction: 'Завийте надясно', distance_meters: 160 }] }], alternatives_count: 0 };
let receiveGps: (position: GeolocationPosition) => void;
const watch = vi.fn((callback: (position: GeolocationPosition) => void) => { receiveGps = callback; return 7; });
const clearWatch = vi.fn();
const gps = (lat = 43) => ({ coords: { latitude: lat, longitude: 25, heading: 0, speed: 5, accuracy: 8 }, timestamp: Date.now() } as GeolocationPosition);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); vi.clearAllMocks();
  vi.mocked(loadGoogleMaps).mockResolvedValue(undefined); vi.mocked(computeRoute).mockResolvedValue(result);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, clearWatch } });
  vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
  vi.stubGlobal('google', { maps: {
    Map: class { fitBounds = vi.fn(); panTo = vi.fn(); getBounds = () => undefined; },
    Marker: marker, Polyline: polyline, Point: class {}, Size: class {},
    SymbolPath: { FORWARD_CLOSED_ARROW: 1 }, LatLngBounds: class { extend = vi.fn(); },
    event: { clearInstanceListeners: vi.fn() },
  } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const props = { targetLat: 43.005, targetLng: 25, pickup: { lat: 43.001, lng: 25 }, destination: { lat: 43.005, lng: 25 } };
it('draws both pins, a car and a directional route when GPS and the route arrive before Maps', async () => {
  let ready!: () => void;
  vi.mocked(loadGoogleMaps).mockReturnValueOnce(new Promise(done => { ready = done; }));
  render(<DriverRouteMap {...props} />);
  await act(async () => receiveGps(gps()));
  expect(marker).not.toHaveBeenCalled(); expect(polyline).not.toHaveBeenCalled();
  await act(async () => ready());
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({ icon: expect.objectContaining({ path: CAR_PATH, rotation: 0 }) }));
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({ position: props.pickup, title: 'A · Начало' }));
  expect(marker).toHaveBeenCalledWith(expect.objectContaining({ position: props.destination, title: 'B · Край' }));
  expect(polyline).toHaveBeenCalledWith(expect.objectContaining({ icons: [expect.objectContaining({ repeat: '120px' })] }));
});
it('accepts consecutive GPS steps under 50 metres, updates progress and refreshes the route', async () => {
  const nav = vi.fn();
  render(<DriverRouteMap {...props} onNavInfo={nav} />);
  await act(async () => receiveGps(gps()));
  for (let n = 1; n <= 10; n++) {
    act(() => vi.advanceTimersByTime(1000));
    await act(async () => receiveGps(gps(43 + n * .0002)));
  }
  expect(computeRoute).toHaveBeenCalledTimes(2);
  expect(computeRoute).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 43.0018 }), expect.anything(), expect.anything());
  expect(nav.mock.lastCall?.[0].distance_km).toBeLessThan(result.distance_km);
});
it('hides live ETA when GPS expires and releases the native GPS watch and layers', async () => {
  const nav = vi.fn();
  const view = render(<DriverRouteMap {...props} onNavInfo={nav} />);
  await act(async () => receiveGps(gps()));
  await act(async () => vi.advanceTimersByTime(45_000));
  expect(screen.getByRole('status').textContent).toContain('Позицията не се обновява');
  expect(nav).toHaveBeenLastCalledWith(null);
  view.unmount();
  expect(clearWatch).toHaveBeenLastCalledWith(7);
  expect(setMap).toHaveBeenCalledWith(null);
});
