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

  const title = payload.title || 'Taxi App';
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
    options.requireInteraction = true;
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

  if (data?.type === 'new_request') {
    url = '/driver/requests';
  } else if (data?.type === 'trip_status') {
    if (data?.role === 'DRIVER') {
      url = '/driver/requests';
    } else {
      url = '/customer/home';
    }
  } else if (data?.type === 'chat') {
    url = data?.url || '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url)) {
          client.focus();
          client.postMessage({ type: 'notification-click', data });
          return;
        }
      }
      self.clients.openWindow(url);
    })
  );
});

// ── MESSAGE FROM CLIENT ──
self.addEventListener('message', (event) => {
  
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});