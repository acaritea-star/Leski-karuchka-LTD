// Service Worker for Push Notifications
// Handles background push events even when the app is closed/sleeping

const CACHE_NAME = 'taxi-push-v1';

self.addEventListener('install', (_event) => {
  
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  
  event.waitUntil(self.clients.claim());
});

// ── PUSH EVENT ──
self.addEventListener('push', (event) => {
  
  if (!event.data) {
    console.warn('[SW] Push event has no data');
    return;
  }

  let payload;
  try {
    payload = event.data.json();
    
  } catch {
    payload = { title: 'Taxi App', body: event.data.text() };
    
  }

  const expires = Date.parse(payload.data?.expires_at || '');
  if (payload.data?.type === 'new_request' && Number.isFinite(expires) && expires <= Date.now()) return;
  const title = payload.title || 'Лески каручка';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/badge-72.png',
    tag: payload.tag || 'taxi-notification',
    requireInteraction: payload.requireInteraction ?? false,
    renotify: payload.renotify ?? true,
    silent: payload.silent ?? false,
    data: payload.data || {},
    actions: payload.actions || [],
    vibrate: payload.vibrate || [200, 100, 200],
  };

  if (payload.data?.type === 'new_request') {
    options.vibrate = [300, 100, 300, 100, 300, 100, 500];
    options.requireInteraction = false;
  } else if (payload.data?.type === 'trip_status') {
    options.vibrate = [150, 50, 150];
  }

  
  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── NOTIFICATION CLICK ──
self.addEventListener('notificationclick', (event) => {
  
  event.notification.close();

  const data = event.notification.data || {};
  let url = '/';

  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (typeof data.notification_id === 'string' && uuid.test(data.notification_id)) {
    url = '/notifications/open?id=' + encodeURIComponent(data.notification_id);
  } else if (data?.type === 'new_request') {
    url = '/driver/requests';
  } else if (data?.type === 'trip_status') {
    if (data?.role === 'DRIVER') {
      url = '/driver/requests';
    } else {
      url = data.status === 'completed' && uuid.test(data.request_id || '') ? '/customer/orders?rate=' + data.request_id : '/customer/home';
    }
  } else if (data?.type === 'no_driver') {
    url = uuid.test(data.request_id || '') ? '/customer/home?retry=' + data.request_id : '/customer/home';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      const target = new URL(url, self.location.origin);
      const client = clientList.find(client => new URL(client.url).origin === target.origin);
      if (client) {
        if (client.url !== target.href && 'navigate' in client) await client.navigate(target.href);
        await client.focus();
      } else await self.clients.openWindow(target.href);
    })
  );
});

// ── MESSAGE FROM CLIENT ──
self.addEventListener('message', (event) => {
  
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});