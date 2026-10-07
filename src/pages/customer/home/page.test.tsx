// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import CustomerHome from './page';
import type { RouteResult } from '@/lib/googleMaps';
import { calculateFare } from '@/lib/pricing';
import { setLocationEnabled } from '@/lib/locationPreference';
import { stopSharedGps } from '@/lib/sharedGps';
import { defaultConsent, saveConsent } from '@/lib/cookieConsent';

const fake = vi.hoisted(() => ({
  readById: vi.fn(), notify: null as null | ((payload: { new: Record<string, unknown> }) => void),
  rpc: vi.fn(), route: vi.fn(), reverse: vi.fn(), register: vi.fn(),
  active: null as Record<string, unknown> | null, recoveryError: false,
  user: { id: 'customer', company_id: 'company', first_name: 'Тест', email: 'test@example.test' },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, loading: false }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register: fake.register }) }));
vi.mock('@/lib/googleMaps', () => ({ computeRoute: fake.route, reverseGeocode: fake.reverse }));
vi.mock('@/pages/customer/components/BookingMap', () => ({ default: () => <div>Map</div> }));
vi.mock('@/pages/customer/components/DriverTracking', () => ({ default: () => <div>Tracking</div> }));
vi.mock('@/components/feature/NotificationBell', () => ({ default: () => null }));
vi.mock('@/pages/customer/components/AppMenu', () => ({ default: () => null }));
vi.mock('@/lib/places', () => ({ hasPlacesApi: () => false }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => ({ abortSignal: () => fake.rpc(...args) }), removeChannel: vi.fn(),
  channel: () => { const channel = { on: (_event: string, _filter: unknown, callback: typeof fake.notify) => { fake.notify = callback; return channel; }, subscribe: () => channel }; return channel; },
  from: (table: string) => {
    const result = () => ({ data: table === 'taxi_requests' ? fake.active : table === 'companies' ? { id: 'company' }
      : [{ id: 'eco', name: 'Economy', capacity: 4, is_active: true }],
    error: table === 'taxi_requests' && fake.recoveryError ? { message: 'offline' } : null });
    let byId = false;
    const query = { select: () => query, abortSignal: () => query, eq: (field: string) => { if (field === 'id') byId = true; return query; }, in: () => query, order: () => query,
      limit: () => query, maybeSingle: async () => table === 'taxi_requests' && byId ? fake.readById() : result(), then: (resolve: (data: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  },
} }));

const pickup = { id: 'a', name: 'Начало', address: 'ул. Иван Вазов 2, Левски', lat: 43.35, lng: 25.14 };
const destination = { id: 'b', name: 'Край', address: 'Гара, Левски', lat: 43.36, lng: 25.13 };
const quote = (): RouteResult => ({ success: true, quote_id: 'quote', quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
  breakdown: calculateFare({ distanceKm: 1.7, durationMin: 5 }), distance_km: 1.7, duration_min: 5, duration_sec: 300, polyline: '', legs: [], alternatives_count: 0 });
const mount = async () => { const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><MemoryRouter><CustomerHome /></MemoryRouter></QueryClientProvider>); await act(async () => {}); };
const chooseRoute = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
  fireEvent.click(screen.getByRole('button', { name: /Край/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(351); });
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.active = null; fake.recoveryError = false;
  fake.readById.mockReset().mockImplementation(async () => ({ data: fake.active, error: null }));
  fake.notify = null;
  fake.route.mockResolvedValue(quote());
  fake.rpc.mockImplementation(async (...args: [string?, { p_request_id: string }?]) => {
    fake.active = { id: args[1]?.p_request_id ?? 'request', customer_id: fake.user.id,
      company_id: 'company', driver_id: null, status: 'pending', pickup_address: pickup.address,
      destination_address: destination.address, pickup_latitude: pickup.lat, pickup_longitude: pickup.lng,
      destination_latitude: destination.lat, destination_longitude: destination.lng, estimated_price: 5 };
    return { data: fake.active, error: null };
  });
  saveConsent({ ...defaultConsent(), functional: true });
  localStorage.setItem('leski_recent_locations', JSON.stringify([pickup, destination]));
});
afterEach(() => { cleanup(); stopSharedGps(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('customer booking integration', () => {
  it('moves through three steps and sends one cash-only RPC on a double click', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'Откъде тръгваш?' })).toBeTruthy();
    await chooseRoute();
    expect(screen.getByRole('heading', { name: 'Готови за път.' })).toBeTruthy();
    const order = screen.getByRole('button', { name: /Поръчай каручка/ });
    fireEvent.click(order); fireEvent.click(order);
    await act(async () => {});
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request', expect.objectContaining({ p_payment_method: 'cash', p_quote_id: 'quote' }));
    expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
  });
  it('invalidates the old price immediately when addresses are swapped', async () => {
    await mount(); await chooseRoute();
    fake.route.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Размени адресите' }));
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it('allows address editing without losing the destination', async () => {
    await mount(); await chooseRoute();
    fireEvent.click(screen.getByRole('button', { name: '1. Откъде тръгваш?' }));
    fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
    expect(screen.getByRole('heading', { name: 'Готови за път.' })).toBeTruthy();
  });
  it('treats browser offline as a hint, but disables ordering after quote expiry', async () => {
    await mount(); await chooseRoute();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Обнови цената');
  });
  it('blocks new booking until recovery succeeds and retries without reloading', async () => {
    fake.recoveryError = true; await mount();
    expect(screen.getByRole('alert').textContent).toContain('активна поръчка');
    expect(screen.queryByRole('searchbox')).toBeNull();
    fake.recoveryError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
    await act(async () => {});
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });
  it('opens the existing request rather than offering a second booking', async () => {
    await fake.rpc(); fake.rpc.mockClear(); await mount();
    expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

it('keeps the accepted Realtime status when a slow earlier poll returns pending, with no overlapping reads', async () => {
  const pending = { id:'request',company_id:'company',driver_id:null,status:'pending',pickup_address:pickup.address,
    destination_address:destination.address,pickup_latitude:pickup.lat,pickup_longitude:pickup.lng,
    destination_latitude:destination.lat,destination_longitude:destination.lng,estimated_price:5,updated_at:'2026-10-03T18:00:00Z' };
  fake.active = pending;
  let finish!: (value: unknown) => void;
  fake.readById.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount();
  expect(fake.readById).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fake.readById).toHaveBeenCalledTimes(1);
  act(() => fake.notify?.({ new:{ ...pending,status:'accepted',driver_id:'driver',updated_at:'2026-10-03T18:00:01Z' } }));
  expect(screen.getByText('Tracking')).toBeTruthy();
  await act(async () => finish({ data:pending,error:null }));
  expect(screen.getByText('Tracking')).toBeTruthy();
});

const gpsFix = (latitude = pickup.lat) => ({ timestamp: Date.now(), coords: { latitude, longitude: pickup.lng, accuracy: 10, heading: null, speed: 0 } } as GeolocationPosition);
const gpsBrowser = (permission: 'granted' | 'denied' | 'prompt' = 'granted') => {
  let receive!: (position: GeolocationPosition) => void;
  const get = vi.fn((cb: (position: GeolocationPosition) => void) => cb(gpsFix()));
  const watch = vi.fn((cb: typeof receive) => { receive = cb; return 9; });
  const query = vi.fn().mockResolvedValue({ state: permission });
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: get, watchPosition: watch, clearWatch: vi.fn() }, permissions: { query } });
  return { get, watch, query, move: (position: GeolocationPosition) => receive(position) };
};
it('uses remembered browser permission on opening and never moves chosen addresses on subsequent fixes', async () => {
  const browser = gpsBrowser(); fake.reverse.mockResolvedValue({ formatted_address: 'GPS адрес' });
  await mount();
  expect(browser.get).toHaveBeenCalledTimes(1);
  expect(browser.watch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('leski:auto-location:customer')).toBe('on');
  expect(screen.getByRole('heading', { name: 'Накъде отиваш?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Край/ }));
  await act(async () => vi.advanceTimersByTimeAsync(351));
  expect(fake.route).toHaveBeenCalledTimes(1);
  await act(async () => browser.move(gpsFix(pickup.lat + .01)));
  await act(async () => vi.advanceTimersByTimeAsync(351));
  expect(fake.route).toHaveBeenCalledTimes(1); expect(fake.reverse).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('GPS адрес').length).toBeGreaterThan(0);
});
it('respects remembered off even if the browser still grants permission', async () => {
  const browser = gpsBrowser(); setLocationEnabled('customer', false);
  await mount();
  expect(browser.get).not.toHaveBeenCalled(); expect(browser.watch).not.toHaveBeenCalled();
});
it('does not ask for permission automatically on a first visit', async () => {
  const browser = gpsBrowser('prompt'); await mount();
  expect(browser.get).not.toHaveBeenCalled(); expect(browser.watch).not.toHaveBeenCalled();
});
it('cannot replace a manual pickup chosen while permission lookup was pending', async () => {
  const browser = gpsBrowser();
  let done!: (value: unknown) => void;
  browser.query.mockReturnValue(new Promise(resolve => { done = resolve; }));
  await mount(); fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
  await act(async () => done({ state: 'granted' }));
  expect(browser.get).not.toHaveBeenCalled();
  expect(screen.getAllByText(pickup.address).length).toBeGreaterThan(0);
});
it('ignores a late reverse-geocoding result after location is turned off', async () => {
  gpsBrowser();
  let done!: (value: unknown) => void;
  fake.reverse.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  await mount();
  await act(async () => setLocationEnabled('customer', false));
  await act(async () => done({ formatted_address: 'GPS адрес' }));
  expect(screen.queryByText('GPS адрес')).toBeNull();
});

it('releases a stuck booking button and retries with the same request ID without accepting the late reply', async () => {
  let done!: (value: unknown) => void;
  fake.rpc.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  await mount(); await chooseRoute();
  fireEvent.click(screen.getByRole('button', { name: /Поръчай каручка/ }));
  await act(async () => {});
  const first = fake.rpc.mock.calls[0][1];
  expect(document.querySelector<HTMLButtonElement>('button[aria-busy="true"]')?.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByRole('alert').textContent).toContain('Провери връзката');
  fireEvent.click(screen.getByRole('button', { name: /Поръчай каручка/ })); await act(async () => {});
  expect(fake.rpc).toHaveBeenCalledTimes(2);
  expect(fake.rpc.mock.calls[1][1].p_request_id).toBe(first.p_request_id);
  expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
  await act(async () => done({ data: { ...fake.active, status: 'cancelled' }, error: null }));
  expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
});
