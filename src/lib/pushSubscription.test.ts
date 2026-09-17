import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), invoke: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.session }, rpc: mocks.rpc, functions: { invoke: mocks.invoke }, from: mocks.from,
} }));
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
});
