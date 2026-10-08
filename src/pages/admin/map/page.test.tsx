// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const api = vi.hoisted(() => ({ load: vi.fn(), maps: [] as Record<string, ReturnType<typeof vi.fn>>[], markers: [] as Record<string, ReturnType<typeof vi.fn>>[] }));
vi.mock('@/pages/admin/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: 'company', companyName: 'Тестова фирма' }) }));
vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: () => Promise.resolve() }));
vi.mock('@/lib/adminData', () => ({ loadFleet: api.load, fleetDriverOnline: (driver: { is_online: boolean }) => driver.is_online }));
import AdminMap from './page';
const driver = { id: 'driver', first_name: 'Иван', last_name: 'Петров', latitude: 43.2, longitude: 25.6, updated_at: new Date().toISOString(), position_at: new Date().toISOString(), is_online: true };
beforeEach(() => {
  vi.clearAllMocks(); api.maps.length = 0; api.markers.length = 0;
  api.load.mockResolvedValue({ rows: [driver], total: 1 });
  vi.stubGlobal('google', { maps: {
    Map: class { constructor() { const map = { setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() }; api.maps.push(map); return map; } },
    Marker: class { constructor() { const marker = { setPosition: vi.fn(), setMap: vi.fn(), setTitle: vi.fn(), setIcon: vi.fn() }; api.markers.push(marker); return marker; } },
    Size: class {}, Point: class {}, LatLngBounds: class { extend() {} },
  } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('refreshes existing markers without rebuilding the map or resetting the operator camera', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><AdminMap /></QueryClientProvider>);
  await screen.findByText('Иван Петров');
  await waitFor(() => expect(api.markers).toHaveLength(1));
  api.load.mockResolvedValue({ rows: [{ ...driver, latitude: 43.201 }], total: 1 });
  await client.invalidateQueries({ queryKey: ['admin-fleet'] });
  await waitFor(() => expect(api.markers[0].setPosition).toHaveBeenCalledWith({ lat: 43.201, lng: 25.6 }));
  expect(api.maps).toHaveLength(1); expect(api.markers).toHaveLength(1);
  expect(api.maps[0].setCenter).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Тестова фирма')).toBeTruthy();
  expect(screen.getByText('Обновяване през 10 сек')).toBeTruthy();
  view.unmount(); expect(api.markers[0].setMap).toHaveBeenCalledWith(null);
});
