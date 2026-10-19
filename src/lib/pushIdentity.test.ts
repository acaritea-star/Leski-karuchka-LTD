import { afterEach, beforeEach, expect, it, vi } from 'vitest';
let values: Map<string, string>;
let notices: { data: { recipient_id?: string }; close: ReturnType<typeof vi.fn> }[];
let write: typeof import('./pushIdentity').writePushIdentity;
beforeEach(async () => {
  vi.resetModules(); values = new Map(); notices = [];
  vi.stubGlobal('caches', { open: async () => ({
    match: async (key: string) => values.has(key) ? new Response(values.get(key)) : undefined,
    put: async (key: string, response: Response) => { values.set(key, await response.text()); },
    delete: async (key: string) => values.delete(key),
  }) });
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ getNotifications: async () => notices }) } });
  write = (await import('./pushIdentity')).writePushIdentity;
});
afterEach(() => vi.unstubAllGlobals());
const stored = () => JSON.parse(values.values().next().value ?? 'null') as { userId: string } | null;
it('preserves the active account across module restarts without storing credentials', async () => {
  await write('alice'); vi.resetModules();
  write = (await import('./pushIdentity')).writePushIdentity;
  expect(stored()).toEqual({ userId: 'alice' });
});
it('clears only other-account notices when switching accounts, then all notices on logout', async () => {
  notices = ['alice', 'bob', undefined].map(recipient_id => ({ data: { recipient_id }, close: vi.fn() }));
  await write('bob');
  expect(notices[0].close).toHaveBeenCalledOnce(); expect(notices[1].close).not.toHaveBeenCalled();
  expect(notices[2].close).toHaveBeenCalledOnce();
  await write(null, 'bob'); expect(stored()).toBeNull(); expect(notices[1].close).toHaveBeenCalledOnce();
});
it('serializes a pending login followed immediately by logout', async () => {
  await Promise.all([write('alice'), write(null, 'alice')]); expect(stored()).toBeNull();
});
it('does not let a delayed old-account logout revoke the current account', async () => {
  await write('bob'); await write(null, 'alice'); expect(stored()).toEqual({ userId: 'bob' });
});
it('fails closed when persistent worker identity cannot be saved', async () => {
  vi.stubGlobal('caches', { open: async () => { throw new Error('Unavailable'); } });
  await expect(write('alice')).rejects.toThrow('Unavailable');
});

it('deletes the old boundary before a new-account storage failure', async () => {
  await write('alice');
  const originalOpen = caches.open;
  vi.spyOn(caches, 'open').mockImplementation(async (...args) => {
    const cache = await originalOpen(...args);
    cache.put = async () => { throw new Error('Quota'); };
    return cache;
  });
  await expect(write('bob')).rejects.toThrow('Quota'); expect(stored()).toBeNull();
});
