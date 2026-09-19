// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import BookingMap from './BookingMap';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import type { RouteResult } from '@/lib/googleMaps';

vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: vi.fn() }));
vi.mock('@/lib/googleMaps', () => ({ decodePolyline: () => [{ lat: 43.35, lng: 25.13 }, { lat: 43.36, lng: 25.14 }] }));
const clearLayer = vi.fn();
const polyline = vi.fn(function () { return { setMap: clearLayer }; });
const fitBounds = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadGoogleMaps).mockResolvedValue(undefined);
  vi.stubGlobal('google', { maps: {
    Map: class { fitBounds = fitBounds; setZoom = vi.fn(); },
    Marker: class { setMap = clearLayer; }, Polyline: polyline,
    Size: class {}, Point: class {}, LatLngBounds: class { extend = vi.fn(); },
    event: { clearInstanceListeners: vi.fn() },
  } });
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = vi.fn(); });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
