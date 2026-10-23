// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import DriverTracking, { type TrackingRequest } from './DriverTracking';

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'customer' } }) }));
vi.mock('@/lib/trackingDriver', () => ({ trackingDriverOptions: () => ({ queryKey: ['tracking-driver-test'], queryFn: async () => ({ info: null }) }) }));
vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: async () => undefined }));
vi.mock('@/lib/googleMaps', () => ({ computeRoute: async () => ({ success: false }), decodePolyline: () => [] }));
vi.mock('@/hooks/useDriverPosition', () => ({ useDriverPosition: () => null, usePositionFreshness: () => false }));
vi.mock('@/hooks/useDrivingRoute', () => ({ useDrivingRoute: () => ({ info: null, path: [] }) }));
vi.mock('@/hooks/useRoadNetwork', () => ({ useRoadNetwork: () => null }));
vi.mock('@/hooks/useVehicleMarker', () => ({ useVehicleMarker: () => ({ current: null }) }));
vi.mock('@/lib/mapLayers', () => ({ mapPinIcon: () => ({}), updateRouteLayer: () => null }));
vi.mock('./CustomerLayout', () => ({ default: ({ map, header, children }: { map: React.ReactNode; header: React.ReactNode; children: React.ReactNode }) => <div>{header}{map}{children}</div> }));
vi.mock('./CustomerRidePayment', () => ({ default: () => null }));
vi.mock('./AppMenu', () => ({ default: () => null }));

type Point = { lat: number; lng: number };
// The two-argument API accepts SW/NE corners, including a wrapped longitude.
// It does not interpret those arguments as arbitrary route endpoints.
class Bounds {
  south = Infinity; north = -Infinity; west = Infinity; east = -Infinity;
  constructor(sw?: Point, ne?: Point) {
    if (sw) { this.south = sw.lat; this.west = sw.lng; }
    if (ne) { this.north = ne.lat; this.east = ne.lng; }
  }
  extend(p: Point) {
    this.south = Math.min(this.south, p.lat); this.north = Math.max(this.north, p.lat);
    this.west = Math.min(this.west, p.lng); this.east = Math.max(this.east, p.lng);
    return this;
  }
}
const fitBounds = vi.fn(), panTo = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('google', { maps: {
    Map: class { fitBounds = fitBounds; panTo = panTo; }, LatLngBounds: Bounds,
    Marker: class { setMap = vi.fn(); setPosition = vi.fn(); },
    event: { clearInstanceListeners: vi.fn() },
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const origin = { lat: 43.0800, lng: 25.6337 };
const request = (destination: Point): TrackingRequest => ({ id: 'ride', driver_id: 'driver', status: 'in_progress',
  pickup_latitude: origin.lat, pickup_longitude: origin.lng, pickup_address: 'Начало',
  destination_latitude: destination.lat, destination_longitude: destination.lng, destination_address: 'Край', trip_ended_at: '2026-10-23T19:24:46Z' });
function show(destination: Point) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><DriverTracking request={request(destination)} /></MemoryRouter>
  </QueryClientProvider>);
}
for (const destination of [{ lat: 43.0831, lng: 25.6227 }, { lat: 43.0700, lng: 25.6400 }, { lat: 43.0700, lng: 25.6200 }, { lat: 43.0900, lng: 25.6400 }]) {
  it(`frames a local ended ride toward ${destination.lat},${destination.lng} without live driver GPS`, async () => {
    show(destination); await act(async () => {});
    const bounds = fitBounds.mock.calls[0][0] as Bounds;
    const longitudeSpan = (bounds.east - bounds.west + 360) % 360;
    expect(longitudeSpan).toBeLessThan(.1);
    expect(bounds.north).toBeGreaterThanOrEqual(Math.max(origin.lat, destination.lat));
    expect(bounds.south).toBeLessThanOrEqual(Math.min(origin.lat, destination.lat));
    expect(bounds.west).toBeLessThanOrEqual(Math.min(origin.lng, destination.lng));
    expect(bounds.east).toBeGreaterThanOrEqual(Math.max(origin.lng, destination.lng));
  });
}
it('recenters on the route after arrival when live driver GPS is intentionally stopped', async () => {
  show({ lat: 43.0831, lng: 25.6227 }); await act(async () => {});
  fitBounds.mockClear(); fireEvent.click(screen.getByRole('button', { name: 'Центрирай картата' }));
  expect(fitBounds).toHaveBeenCalledOnce(); expect(panTo).not.toHaveBeenCalled();
});
