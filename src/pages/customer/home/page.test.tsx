// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import CustomerHome from './page';
import type { RouteResult } from '@/lib/googleMaps';
import { calculateFare } from '@/lib/pricing';

const fake = vi.hoisted(() => ({
  rpc: vi.fn(), route: vi.fn(), reverse: vi.fn(), register: vi.fn(), push: vi.fn(),
  active: null as Record<string, unknown> | null, recoveryError: false,
  user: { id: 'customer', company_id: 'company', first_name: 'Тест', email: 'test@example.test' },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, loading: false }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register: fake.register }) }));
vi.mock('@/lib/push', () => ({ broadcastPushToDrivers: fake.push }));
vi.mock('@/lib/googleMaps', () => ({ computeRoute: fake.route, reverseGeocode: fake.reverse }));
vi.mock('@/pages/customer/components/BookingMap', () => ({ default: () => <div>Map</div> }));
vi.mock('@/pages/customer/components/DriverTracking', () => ({ default: () => <div>Tracking</div> }));
vi.mock('@/components/feature/NotificationBell', () => ({ default: () => null }));
vi.mock('@/pages/customer/components/AppMenu', () => ({ default: () => null }));
vi.mock('@/lib/places', () => ({ hasPlacesApi: () => false }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: fake.rpc, removeChannel: vi.fn(),
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  from: (table: string) => {
    const result = () => ({ data: table === 'taxi_requests' ? fake.active : table === 'companies' ? { id: 'company' }
      : [{ id: 'eco', name: 'Economy', capacity: 4, is_active: true }],
    error: table === 'taxi_requests' && fake.recoveryError ? { message: 'offline' } : null });
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      limit: () => query, maybeSingle: async () => result(), then: (resolve: (data: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  },
} }));

const pickup = { id: 'a', name: 'Начало', address: 'ул. Иван Вазов 2, Левски', lat: 43.35, lng: 25.14 };
const destination = { id: 'b', name: 'Край', address: 'Гара, Левски', lat: 43.36, lng: 25.13 };
const quote = (): RouteResult => ({ success: true, quote_id: 'quote', quote_expires_at: new Date(Date.now() + 60_000).toISOString(),
  breakdown: calculateFare({ distanceKm: 1.7, durationMin: 5 }), distance_km: 1.7, duration_min: 5, duration_sec: 300, polyline: '', legs: [], alternatives_count: 0 });
const mount = async () => { render(<MemoryRouter><CustomerHome /></MemoryRouter>); await act(async () => {}); };
const chooseRoute = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
  fireEvent.click(screen.getByRole('button', { name: /Край/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(351); });
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.active = null; fake.recoveryError = false;
  fake.route.mockResolvedValue(quote());
  fake.rpc.mockImplementation(async () => {
    fake.active = { id: 'request', company_id: 'company', driver_id: null, status: 'pending', pickup_address: pickup.address,
      destination_address: destination.address, pickup_latitude: pickup.lat, pickup_longitude: pickup.lng,
      destination_latitude: destination.lat, destination_longitude: destination.lng, estimated_price: 5 };
    return { data: fake.active, error: null };
  });
  localStorage.setItem('leski_recent_locations', JSON.stringify([pickup, destination]));
});
afterEach(() => { cleanup(); localStorage.clear(); vi.useRealTimers(); });

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
  it('keeps ordering disabled while offline or after quote expiry', async () => {
    await mount(); await chooseRoute();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(true);
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
