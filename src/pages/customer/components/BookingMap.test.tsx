// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import { requestGps, stopSharedGps } from '@/lib/sharedGps';
import BookingMap from './BookingMap';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import type { RouteResult } from '@/lib/googleMaps';

vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: vi.fn() }));
vi.mock('@/lib/googleMaps', () => ({ decodePolyline: () => [{ lat: 43.35, lng: 25.13 }, { lat: 43.36, lng: 25.14 }] }));
const clearLayer = vi.fn();
const polyline = vi.fn(function () { return { setMap: clearLayer, setPath };  });
const fitBounds = vi.fn();
const panTo = vi.fn();
const markerCreated = vi.fn();
const movePin = vi.fn();
const setPath = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadGoogleMaps).mockResolvedValue(undefined);
  vi.stubGlobal('google', { maps: {
    Map: class { panTo = panTo; fitBounds = fitBounds; setZoom = vi.fn(); },
    Marker: class { constructor() { markerCreated(); } setMap = clearLayer; setPosition = movePin; setTitle = vi.fn(); }, Polyline: polyline,
    SymbolPath: { FORWARD_CLOSED_ARROW: 1 }, Size: class {}, Point: class {}, LatLngBounds: class { extend = vi.fn(); },
    event: { clearInstanceListeners: vi.fn() },
  } });
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); stopSharedGps(); vi.unstubAllGlobals(); });
const pickup = { address: 'A', lat: 43.35, lng: 25.13 };
const destination = { address: 'B', lat: 43.36, lng: 25.14 };

it('draws only the quoted road route, and removes it as soon as the parent invalidates it', async () => {
  const view = render(<BookingMap pickup={pickup} destination={destination} route={null} />);
  await act(async () => {});
  expect(polyline).not.toHaveBeenCalled();
  view.rerender(<BookingMap pickup={pickup} destination={destination} route={{ polyline: 'quoted' } as RouteResult} />);
  expect(polyline).toHaveBeenCalledTimes(2); // Route + white casing.
  expect(fitBounds).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ top: 94 }));
  view.rerender(<BookingMap pickup={pickup} destination={destination} route={null} />);
  expect(clearLayer).toHaveBeenCalledWith(null);
});

it('offers a map-load retry while keeping booking usable', async () => {
  vi.mocked(loadGoogleMaps).mockRejectedValueOnce(new Error('network'));
  render(<BookingMap pickup={null} destination={null} route={null} />);
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('Картата не се зареди');
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  await act(async () => {});
  expect(loadGoogleMaps).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();
});

it('preserves pins, lines and camera on identical polled coordinates and refreshed prices', async () => {
  const view = render(<BookingMap pickup={pickup} destination={destination} route={{ polyline: 'quoted' } as RouteResult} />);
  await act(async () => {});
  const fits = fitBounds.mock.calls.length;
  view.rerender(<BookingMap pickup={{ ...pickup }} destination={{ ...destination }} route={{ polyline: 'quoted', distance_km: 9 } as RouteResult} />);
  expect(markerCreated).toHaveBeenCalledTimes(2);
  expect(polyline).toHaveBeenCalledTimes(2);
  expect(fitBounds).toHaveBeenCalledTimes(fits);
  expect(clearLayer).not.toHaveBeenCalled();
  view.rerender(<BookingMap pickup={{ ...pickup, lat: 43.351 }} destination={destination} route={null} />);
  expect(markerCreated).toHaveBeenCalledTimes(2);
  expect(movePin).toHaveBeenCalledWith(expect.objectContaining({ lat: 43.351 }));
});

it('never acquires GPS itself and centers once on the shared fix without following later movement', async () => {
  const get = vi.fn((cb: (position: GeolocationPosition) => void) => cb({ timestamp: Date.now(), coords: { latitude: 43.35, longitude: 25.13, accuracy: 10 } } as GeolocationPosition));
  const permission = vi.fn().mockResolvedValue({ state: 'granted' });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: get }, permissions: { query: permission } });
  render(<BookingMap pickup={null} destination={null} route={null} />);
  await act(async () => {});
  expect(get).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
  await act(async () => { await requestGps(); });
  expect(panTo).toHaveBeenCalledWith({ lat: 43.35, lng: 25.13 });
  await act(async () => { await requestGps(); });
  expect(panTo).toHaveBeenCalledTimes(1);
});
