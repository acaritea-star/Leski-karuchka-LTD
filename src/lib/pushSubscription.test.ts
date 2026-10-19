import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), from: vi.fn(), identity: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.session }, rpc: mocks.rpc, functions: { invoke: mocks.invoke }, from: mocks.from,
} }));
vi.mock('./pushIdentity', () => ({ writePushIdentity: mocks.identity }));
let push: typeof import('./pushSubscription');
let subscription: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => object };
let manager: { getSubscription: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };
let storage: Map<string, string>;
let filters: Array<[string, string]>;

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  storage = new Map(); filters = [];
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const notification = { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') };
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('window', { Notification: notification, PushManager: {} });
  subscription = {
    endpoint: 'https://fcm.googleapis.com/test-device', unsubscribe: vi.fn().mockResolvedValue(true),
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: 'public-key', auth: 'auth-key' } }),
  };
  manager = { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn().mockResolvedValue(subscription) };
  const registration = { pushManager: manager };
  vi.stubGlobal('navigator', { userAgent: 'test', serviceWorker: {
    register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration),
    getRegistration: vi.fn().mockResolvedValue(registration),
  } });
  mocks.session.mockResolvedValue({ data: { session: { user: { id: 'alice' } } } });
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ error: null }) });
  mocks.invoke.mockResolvedValue({ data: { publicKey: btoa('test-key') }, error: null });
  const query = { eq: (key: string, value: string) => { filters.push([key, value]); return query; },
    abortSignal: () => Promise.resolve({ error: null }) };
  mocks.from.mockReturnValue({ delete: () => query });
  push = await import('./pushSubscription');
});
afterEach(() => vi.unstubAllGlobals());

describe('push account and device isolation', () => {
  it('rotates an endpoint inherited from another account and uses the authenticated RPC', async () => {
    storage.set('leski_push_owner', 'bob');
    expect(await push.registerPush('alice')).toBe(true);
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(manager.subscribe).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('register_push_subscription', {
      p_endpoint: subscription.endpoint, p_p256dh: 'public-key', p_auth: 'auth-key', p_user_agent: 'test',
    });
    expect(push.getPushOwner()).toBe('alice');
  });
  it('deduplicates simultaneous registrations from multiple components', async () => {
    await Promise.all([push.registerPush('alice'), push.registerPush('alice')]);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it('unsubscribes and removes only this device, preserving other devices', async () => {
    await push.unregisterPush('alice');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(filters).toEqual([['user_id', 'alice'], ['endpoint', subscription.endpoint]]);
    expect(await push.registerPush('alice')).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not register a stale account after the session changes', async () => {
    mocks.session.mockResolvedValueOnce({ data: { session: { user: { id: 'bob' } } } });
    expect(await push.registerPush('alice')).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('lets logout win over an in-flight registration', async () => {
    let finish!: (value: object) => void;
    mocks.rpc.mockReturnValueOnce({ abortSignal: () => new Promise((resolve) => { finish = resolve; }) });
    const registering = push.registerPush('alice');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    const unregistering = push.unregisterPush('alice');
    finish({ error: null });
    expect(await registering).toBe(false);
    await unregistering;
    expect(push.getPushOwner()).toBeNull();
    expect(filters).toContainEqual(['endpoint', subscription.endpoint]);
    expect(await push.registerPush('alice')).toBe(false);
  });
  it('does not show enabled when the server rejects registration', async () => {
    mocks.rpc.mockReturnValueOnce({ abortSignal: () => Promise.resolve({ error: new Error('Registration unavailable') }) });
    await expect(push.registerPush('alice')).rejects.toThrow('Registration unavailable');
    expect(push.getPushOwner()).toBeNull();
  });
  it('does not wait for serviceWorker.ready on a device without a registration', async () => {
    vi.stubGlobal('navigator', { serviceWorker: {
      getRegistration: vi.fn().mockResolvedValue(undefined), ready: new Promise(() => {}),
    } });
    await push.unregisterPush('alice');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('revokes server delivery even when the browser cannot unsubscribe', async () => {
    subscription.unsubscribe.mockRejectedValueOnce(new Error('Browser unavailable'));
    await push.unregisterPush('alice');
    expect(filters).toContainEqual(['endpoint', subscription.endpoint]);
    expect(push.getPushOwner()).toBeNull();
  });
  it('honors the previous notification opt-out', async () => {
    storage.set('leski_notifications_enabled', 'false');
    expect(await push.registerPush('alice')).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('preserves the enabled choice across logout and restores silently on a verified login', async () => {
    storage.set('leski_push_enabled:alice', 'true');
    await push.registerPush('alice');
    await push.detachPush('alice');
    expect(storage.get('leski_push_enabled:alice')).toBe('true');
    expect(await push.registerPush('alice')).toBe(false);
    push.startPushSession('alice');
    expect(await push.registerPush('alice')).toBe(true);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('keeps the settings opt-out after a later login', async () => {
    await push.unregisterPush('alice');
    push.startPushSession('alice');
    expect(await push.registerPush('alice')).toBe(false);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('only requests permission on an explicit enable action when the decision is unknown', async () => {
    Object.assign(Notification, { permission: 'default' });
    expect(await push.registerPush('alice')).toBe(false);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
    vi.mocked(Notification.requestPermission).mockImplementationOnce(async () => {
      Object.assign(Notification, { permission: 'granted' }); return 'granted';
    });
    expect(await push.enablePush('alice')).toBe(true);
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
    expect(await push.enablePush('alice')).toBe(true);
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
  });
  it('does not ask again after the browser has denied permission', async () => {
    Object.assign(Notification, { permission: 'denied' });
    expect(await push.enablePush('alice')).toBe(false);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('repairs a lost browser subscription instead of trusting a cached owner', async () => {
    await push.registerPush('alice');
    manager.getSubscription.mockResolvedValueOnce(null);
    await push.registerPush('alice');
    expect(manager.subscribe).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
  it('inspects a healthy browser endpoint on resume without repeating the server write', async () => {
    storage.set('leski_push_owner', 'alice');
    await push.registerPush('alice'); await push.registerPush('alice');
    expect(manager.getSubscription).toHaveBeenCalledTimes(2); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it('updates the worker boundary on external logout and a new login', async () => {
    await push.changePushSession('alice'); await push.changePushSession(null); await push.changePushSession('bob');
    expect(mocks.identity.mock.calls).toEqual([['alice'], [null], ['bob']]);
    expect(push.getPushOwner()).toBeNull();
  });
  it('keeps device delivery disabled when logout cleanup fails', async () => {
    await push.registerPush('alice');
    subscription.unsubscribe.mockRejectedValueOnce(new Error('Browser unavailable'));
    mocks.from.mockReturnValueOnce({ delete: () => ({ eq: () => ({ eq: () => ({ abortSignal: async () => ({ error: new Error('Offline') }) }) }) }) });
    await expect(push.detachPush('alice')).rejects.toThrow('Offline');
    expect(push.getPushOwner()).toBeNull(); expect(mocks.identity).toHaveBeenLastCalledWith(null, 'alice');
  });
  it('removes a stale owner marker even when the browser subscription has already gone', async () => {
    storage.set('leski_push_owner', 'alice'); manager.getSubscription.mockResolvedValueOnce(null);
    await push.detachPush('alice'); expect(storage.has('leski_push_owner')).toBe(false);
  });
  it('invalidates a registration in flight without saving a logout as an opt-out', async () => {
    let finish!: (value: object) => void;
    mocks.rpc.mockReturnValueOnce({ abortSignal: () => new Promise(resolve => { finish = resolve; }) });
    const registering = push.registerPush('alice');
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    const leaving = push.detachPush('alice'); finish({ error: null });
    expect(await registering).toBe(false); await leaving;
    expect(storage.has('leski_push_enabled:alice')).toBe(false);
    expect(push.getPushOwner()).toBeNull();
  });
});
