// Push only: no caching of routes, financial data or authenticated responses.
const IDENTITY_CACHE = 'leski-push-identity-v1';
const IDENTITY_KEY = '/__leski_push_identity__';
const APP_ICON = '/icon-192.png';

async function currentRecipient() {
  try {
    const cache = await self.caches.open(IDENTITY_CACHE);
    const stored = await cache.match(IDENTITY_KEY);
    const identity = stored ? await stored.json() : null;
    return typeof identity?.userId === 'string' ? identity.userId : null;
  } catch { return null; } // Unknown identity must never display another account's content.
}
async function belongsToCurrentAccount(data) {
  return typeof data?.recipient_id === 'string' && data.recipient_id === await currentRecipient();
}

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const recipient = await currentRecipient();
    for (const notice of await self.registration.getNotifications()) {
      if (!recipient || notice.data?.recipient_id !== recipient) notice.close();
    }
  })());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { return; }
  event.waitUntil((async () => {
    if (!payload || !await belongsToCurrentAccount(payload.data)) return;
    const expires = Date.parse(payload.data?.expires_at || '');
    if (Number.isFinite(expires) && expires <= Date.now()) return;
    const options = {
      body: payload.body || '',
      icon: !payload.icon || payload.icon === '/icon-192.png' ? APP_ICON : payload.icon,
      tag: payload.tag || 'notice-' + payload.data.recipient_id,
      requireInteraction: false,
      renotify: payload.renotify ?? false,
      silent: payload.silent ?? false,
      data: payload.data,
      actions: payload.actions || [],
      vibrate: payload.data.type === 'new_request' ? [300, 100, 300, 100, 300, 100, 500] : [150, 50, 150],
    };
    options.badge = payload.badge || '/badge-72.png';
    await self.registration.showNotification(payload.title || 'Лески каручка', options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const data = event.notification.data || {};
    if (!await belongsToCurrentAccount(data)) return;
    let url = '/';
    const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (typeof data.notification_id === 'string' && uuid.test(data.notification_id)) {
      url = '/notifications/open?id=' + encodeURIComponent(data.notification_id);
    } else if (data.type === 'new_request' || data.role === 'DRIVER' && data.type === 'trip_status') {
      url = '/driver/requests';
    } else if (data.type === 'trip_status') {
      url = data.status === 'completed' && uuid.test(data.request_id || '') ? '/customer/orders?rate=' + data.request_id : '/customer/home';
    } else if (data.type === 'no_driver') {
      url = uuid.test(data.request_id || '') ? '/customer/home?retry=' + data.request_id : '/customer/home';
    }
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL(url, self.location.origin);
    const client = clientList.find(client => new URL(client.url).origin === target.origin);
    if (client) {
      if (client.url !== target.href && 'navigate' in client) await client.navigate(target.href);
      await client.focus();
    } else await self.clients.openWindow(target.href);
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
