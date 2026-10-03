// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import LocationSettings from './LocationSettings';
import { setLocationEnabled } from '@/lib/locationPreference';
import { stopSharedGps, subscribeGps } from '@/lib/sharedGps';
import { queryKeys } from '@/lib/queryKeys';
const fake = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), update: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'setting-user' } }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: fake.read, abortSignal: () => ({ maybeSingle: fake.read }) }) }),
  update: fake.update,
}) } }));
const watch = vi.fn(() => 3), clearWatch = vi.fn();
const get = vi.fn((cb: (position: GeolocationPosition) => void) => cb({ timestamp: Date.now(), coords: { latitude: 43.3, longitude: 25.1, accuracy: 10 } } as GeolocationPosition));
let release = () => {};
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: get, watchPosition: watch, clearWatch } });
  fake.read.mockResolvedValue({ data: { id: 'driver', user_id: 'setting-user', company_id: 'company', is_online: true }, error: null });
  fake.update.mockReturnValue({ eq: () => ({ select: () => ({ abortSignal: () => ({ single: fake.write }) }) }) });
  fake.write.mockResolvedValue({ data: { id: 'driver', company_id: 'company', is_online: false }, error: null });
});
afterEach(() => { cleanup(); release(); stopSharedGps(); localStorage.clear(); });
const mount = async (driver = false) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><LocationSettings driver={driver} /></QueryClientProvider>);
  await act(async () => {});
  return client;
};
it('enables and remembers GPS after an explicit settings click, with no database writes for customers', async () => {
  await mount();
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('switch'));
  await act(async () => {});
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  expect(localStorage.getItem('leski:auto-location:setting-user')).toBe('on');
  expect(fake.update).not.toHaveBeenCalled();
});
it('stops the shared watcher and confirms offline on the server without requesting GPS', async () => {
  setLocationEnabled('setting-user', true); release = subscribeGps(() => {});
  const client = await mount(true);
  fireEvent.click(screen.getByRole('switch')); await act(async () => {});
  expect(clearWatch).toHaveBeenCalledWith(3); expect(get).not.toHaveBeenCalled();
  expect(fake.update).toHaveBeenCalledWith({ is_online: false });
  expect(client.getQueryData(queryKeys.driverRecord('setting-user'))).toMatchObject({ is_online: false });
  expect(localStorage.getItem('leski:auto-location:setting-user')).toBe('off');
});
it('keeps GPS off and offers a retry instead of claiming offline when the server rejects the change', async () => {
  setLocationEnabled('setting-user', true);
  fake.write.mockResolvedValueOnce({ data: null, error: { message: 'No network' } });
  const client = await mount(true);
  fireEvent.click(screen.getByRole('switch')); await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('още не е потвърдено');
  expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');
  expect(client.getQueryData(queryKeys.driverRecord('setting-user'))).toMatchObject({ is_online: true });
  fireEvent.click(screen.getByRole('button', { name: 'Повтори извеждането офлайн' }));
  await act(async () => {});
  expect(client.getQueryData(queryKeys.driverRecord('setting-user'))).toMatchObject({ is_online: false });
  expect(screen.queryByRole('alert')).toBeNull();
});
