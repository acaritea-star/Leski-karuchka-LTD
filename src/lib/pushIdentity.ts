// Shared with sw.js. This cache contains only the active account ID, never tokens.
const CACHE = 'leski-push-identity-v1';
const KEY = '/__leski_push_identity__';
let queue: Promise<unknown> = Promise.resolve();

/** Persist the account boundary across worker restarts and remove old OS notices. */
export function writePushIdentity(userId: string | null, expectedOwner?: string): Promise<void> {
  const operation = async () => {
    if (!('caches' in globalThis)) throw new Error('Push identity storage unavailable');
    const cache = await caches.open(CACHE);
    const previous = await cache.match(KEY);
    const identity = previous ? await previous.json().catch(() => null) as { userId?: string } | null : null;
    // A delayed logout from the old account must not revoke a newer login.
    if (expectedOwner && identity?.userId && identity.userId !== expectedOwner) return;
    // Delete the previous boundary first: a quota error must fail closed.
    if (identity?.userId !== userId || !userId) await cache.delete(KEY);
    try {
      if (userId) {
        await cache.put(KEY, new Response(JSON.stringify({ userId }), { headers: { 'Content-Type': 'application/json' } }));
      }
    } finally {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const notices = await registration?.getNotifications?.() ?? [];
        for (const notice of notices) {
          if (!userId || notice.data?.recipient_id !== userId) notice.close();
        }
      }
    }
  };
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
