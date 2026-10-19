import { beforeEach, expect, it, vi } from 'vitest';
import source from '../../public/sw.js?raw';

const id = '55555555-5555-4555-8555-555555555555';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
let recipient: string | null;
let handlers: Record<string, (event: unknown) => void>;
let clients: { url: string; navigate: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }[];
let notices: { data: { recipient_id?: string }; close: ReturnType<typeof vi.fn> }[];
const shown = vi.fn(), opened = vi.fn();
function boot() {
  handlers = {};
  const worker = {
    location: { origin: 'https://leskikaruchka.com' },
    caches: { open: async () => ({ match: async () => recipient ? new Response(JSON.stringify({ userId: recipient })) : undefined }) },
    addEventListener: (type: string, handler: (event: unknown) => void) => { handlers[type] = handler; },
    registration: { showNotification: shown, getNotifications: async () => notices },
    clients: { matchAll: async () => clients, openWindow: opened, claim: vi.fn() },
  };
  new Function('self', source)(worker);
}
beforeEach(() => {
  vi.clearAllMocks(); clients = []; notices = []; recipient = alice; boot();
});
async function dispatch(type: string, value: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  handlers[type]({ ...value, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
  await Promise.all(pending);
}
const payload = (recipient_id = alice, extra: Record<string, unknown> = {}) => ({
  title: 'Шофьорът пристигна', body: 'Отвори приложението.',
  data: { recipient_id, type: 'trip_status', notification_id: id, ...extra },
});
const push = (value: unknown) => dispatch('push', { data: { json: () => value } });

it('shows a matching customer push after a worker restart without an open app', async () => {
  boot(); await push(payload());
  expect(shown).toHaveBeenCalledWith('Шофьорът пристигна', expect.objectContaining({ renotify: false, data: expect.objectContaining({ recipient_id: alice }) }));
});
it('rejects a delayed push from the previous account after another customer signs in', async () => {
  recipient = bob; await push(payload(alice));
  expect(shown).not.toHaveBeenCalled();
  await push(payload(bob)); expect(shown).toHaveBeenCalledOnce();
});
it('rejects pushes after logout and payloads without a recipient', async () => {
  recipient = null; await push(payload());
  recipient = alice; await push({ title: 'Legacy', data: { type: 'trip_status' } });
  expect(shown).not.toHaveBeenCalled();
});
it.each(['new_request', 'trip_status'])('does not show an expired %s notification', async type => {
  await push(payload(alice, { type, expires_at: '2020-01-01T00:00:00Z' }));
  expect(shown).not.toHaveBeenCalled();
});
it('does not display malformed push text or a malformed recipient', async () => {
  await dispatch('push', { data: { json: () => { throw new Error('invalid'); }, text: () => 'unscoped content' } });
  await push(null); await push({ data: { recipient_id: 1 } });
  expect(shown).not.toHaveBeenCalled();
});
it('removes old-account and unscoped notifications when the updated worker activates', async () => {
  notices = [alice, bob, undefined].map(recipient_id => ({ data: { recipient_id }, close: vi.fn() }));
  await dispatch('activate');
  expect(notices[0].close).not.toHaveBeenCalled();
  expect(notices[1].close).toHaveBeenCalledOnce(); expect(notices[2].close).toHaveBeenCalledOnce();
});
it('does not navigate an old-account notification after an account switch', async () => {
  recipient = bob;
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: payload().data } });
  expect(opened).not.toHaveBeenCalled();
});
it('opens a new notification through the authenticated resolver', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: payload().data } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/notifications/open?id=' + id);
});
it('navigates an existing tab instead of focusing a page that ignores the notification', async () => {
  const client = { url: 'https://leskikaruchka.com/customer/profile', navigate: vi.fn().mockResolvedValue(null), focus: vi.fn() };
  clients = [client];
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { recipient_id: alice, type: 'no_driver', request_id: id } } });
  expect(client.navigate).toHaveBeenCalledWith('https://leskikaruchka.com/customer/home?retry=' + id);
  expect(client.focus).toHaveBeenCalledOnce(); expect(opened).not.toHaveBeenCalled();
});
it('routes legacy completed-trip notices to the rating screen', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { recipient_id: alice, type: 'trip_status', status: 'completed', role: 'CUSTOMER', request_id: id } } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/customer/orders?rate=' + id);
});
it('does not follow an external URL supplied in a notification', async () => {
  await dispatch('notificationclick', { notification: { close: vi.fn(), data: { recipient_id: alice, type: 'chat', url: 'https://untrusted.invalid' } } });
  expect(opened).toHaveBeenCalledWith('https://leskikaruchka.com/');
});
