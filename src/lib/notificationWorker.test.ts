import { beforeEach, expect, it, vi } from 'vitest';
import source from '../../public/sw.js?raw';

const id = '55555555-5555-4555-8555-555555555555';
let handlers: Record<string, (event: unknown) => void>;
let clients: { url: string; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[];
const shown = vi.fn(), opened = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); handlers = {}; clients = [];
  const worker = { location: { origin: 'https://leskikaruchka.com' },
    addEventListener: (type: string, handler: (event: unknown) => void) => { handlers[type] = handler; },
    registration: { showNotification: shown },
    clients: { matchAll: async () => clients, openWindow: opened },
  };
  new Function('self', source)(worker);
});
async function dispatch(type: string, value: Record<string, unknown>) {
  const pending: Promise<unknown>[] = [];
  handlers[type]({ ...value, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  await Promise.all(pending);
}
it('does not show an incoming offer that has already expired', async () => {
  await dispatch('push', { data: { json: () => ({ title: 'Expired', data: { type: 'new_request', expires_at: '2020-01-01T00:00:00Z' } }) } });
  expect(shown).not.toHaveBeenCalled();
});
it('opens a new notification through the authenticated resolver', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { notification_id: id, role: 'COMPANY_ADMIN' } } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/notifications/open?id=' + id);
});
it('navigates an existing tab instead of focusing a page that ignores the notification', async () => {
  const client = { url: 'https://leskikaruchka.com/customer/profile', navigate: vi.fn().mockResolvedValue(null), focus: vi.fn() };
  clients = [client];
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { type: 'no_driver', request_id: id } } });
  expect(client.navigate).toHaveBeenCalledWith('https://leskikaruchka.com/customer/home?retry=' + id);
  expect(client.focus).toHaveBeenCalledOnce(); expect(opened).not.toHaveBeenCalled();
});
it('routes legacy completed-trip notices to the rating screen', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { type: 'trip_status', status: 'completed', role: 'CUSTOMER', request_id: id } } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/customer/orders?rate=' + id);
});
it('does not follow an external URL supplied in a notification', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { type: 'chat', url: 'https://untrusted.invalid' } } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/');
});
