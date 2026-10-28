import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from './requestTimeout';
import { writePushIdentity } from './pushIdentity';

const OWNER_KEY = 'leski_push_owner';
const BROWSER_OWNER_KEY = 'leski_push_browser_owner';
const preferenceKey = (userId: string) => `leski_push_enabled:${userId}`;
const memory = new Map<string, string>();
function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}
function save(key: string, value: string | null) {
  if (value === null) memory.delete(key); else memory.set(key, value);
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
  catch { /* Keep this session usable when device storage is unavailable. */ }
}
let owner: string | null = null;
let revision = 0;
let validatedEndpoint: string | null = null;
let validatedAt = 0;
let registering: { userId: string; revision: number; promise: Promise<boolean> } | null = null;
const suspended = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();
export const getPushOwner = () => owner;
export function subscribePush(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function setOwner(value: string | null) {
  owner = value;
  listeners.forEach((listener) => listener());
}
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
async function bounded<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Notifications timed out')), 10000);
    })]);
  } finally { clearTimeout(timer); }
}
export const pushSupported = () => 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator;
export function getPushPreference(userId: string): boolean | null {
  const value = stored(preferenceKey(userId)) ?? stored('leski_notifications_enabled');
  return value === 'false' ? false : value === 'true' ? true : null;
}
const allowed = (userId: string) => pushSupported() && Notification.permission === 'granted'
  && !suspended.has(userId) && getPushPreference(userId) !== false;

/** Also called for remote logout and account changes, before a profile finishes loading. */
export function changePushSession(userId: string | null): Promise<void> {
  const previousOwner = owner ?? stored(OWNER_KEY);
  revision++;
  if (owner !== userId) setOwner(null);
  if (userId) suspended.delete(userId);
  const boundary = bounded(writePushIdentity(userId && getPushPreference(userId) !== false ? userId : null));
  // Auth can end outside the logout button. Revoke the old browser endpoint
  // as well, so providers do not keep sending suppressed, account-mismatched pushes.
  if (previousOwner && previousOwner !== userId) {
    // A different account must release the old browser endpoint immediately,
    // even if its token can no longer delete the previous owner's server row.
    return Promise.all([boundary, detachPush(previousOwner, userId === null)]).then(() => undefined);
  }
  return boundary;
}

export function registerPush(userId: string): Promise<boolean> {
  if (registering?.userId === userId && registering.revision === revision) return registering.promise;
  const started = revision;
  const promise = serialized(async () => {
    const stillCurrent = () => started === revision && allowed(userId);
    if (!stillCurrent()) return false;
    const { data } = await bounded(supabase.auth.getSession());
    if (data.session?.user.id !== userId || !stillCurrent()) return false;
    await bounded(navigator.serviceWorker.register('/sw.js'));
    const registration = await bounded(navigator.serviceWorker.ready);
    if (!stillCurrent()) return false;
    let subscription = await bounded(registration.pushManager.getSubscription());
    // A shared browser must not reuse the previous account's delivery endpoint.
    if (subscription && (stored(BROWSER_OWNER_KEY) ?? stored(OWNER_KEY)) !== userId) {
      if (!await bounded(subscription.unsubscribe())) throw new Error('Could not release old subscription');
      save(BROWSER_OWNER_KEY, null);
      subscription = null;
    }
    if (!subscription) {
      setOwner(null);
      const { data: vapid, error } = await bounded(supabase.functions.invoke('generate-vapid-keys'));
      if (error || !vapid?.publicKey) throw new Error('Push key unavailable');
      if (!stillCurrent()) return false;
      const key = Uint8Array.from(atob(vapid.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      subscription = await bounded(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    }
    if (!stillCurrent()) return false;
    const { data: current } = await bounded(supabase.auth.getSession());
    if (current.session?.user.id !== userId) return false;
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys) throw new Error('Invalid browser subscription');
    // Always inspect the browser on resume. Healthy endpoints need no server
    // write more than once in five minutes; renewed ones are repaired at once.
    if (owner !== userId || validatedEndpoint !== json.endpoint || Date.now() - validatedAt >= 300_000) {
      const body = {
        p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
        p_user_agent: navigator.userAgent,
      };
      const { error } = await withRequestTimeout(signal => supabase.rpc('register_push_subscription', body).abortSignal(signal));
      if (error) throw error;
      save(OWNER_KEY, userId);
      save(BROWSER_OWNER_KEY, userId);
      validatedEndpoint = json.endpoint;
      validatedAt = Date.now();
    }
    if (!stillCurrent()) return false;
    await bounded(writePushIdentity(userId));
    if (!stillCurrent()) return false;
    if (getPushPreference(userId) === null) save(preferenceKey(userId), 'true');
    setOwner(userId);
    return true;
  });
  const pending = { userId, revision: started, promise };
  registering = pending;
  void promise.finally(() => { if (registering === pending) registering = null; }).catch(() => {});
  return promise;
}

/** A verified new login resumes delivery without changing the saved choice. */
export function startPushSession(userId: string) { suspended.delete(userId); }

/** Logout revokes delivery and clears the worker identity. Keep a browser
 * subscription for the same account: WebKit can require another gesture to
 * recreate it even though notification permission is already granted. */
export function detachPush(userId: string, preserveBrowser = true): Promise<void> {
  revision++;
  suspended.add(userId);
  if (owner === userId) setOwner(null);
  // Clear the worker boundary immediately, even while registration is in flight.
  let boundaryError: unknown;
  const cleared = bounded(writePushIdentity(null, userId)).catch(error => { boundaryError = error; });
  return serialized(async () => {
    await cleared;
    if (!('serviceWorker' in navigator)) return;
    const registeredOwner = stored(OWNER_KEY) ?? stored(BROWSER_OWNER_KEY);
    if (registeredOwner && registeredOwner !== userId) return;
    const registration = await bounded(navigator.serviceWorker.getRegistration('/'));
    const subscription = registration ? await bounded(registration.pushManager.getSubscription()) : null;
    if (subscription) {
      let revokeError: unknown;
      try {
        const { error } = await withRequestTimeout(signal => supabase.from('push_subscriptions').delete()
          .eq('user_id', userId).eq('endpoint', subscription.endpoint).abortSignal(signal));
        revokeError = error;
      } catch (error) { revokeError = error; }
      if (preserveBrowser && !revokeError && !boundaryError) save(BROWSER_OWNER_KEY, userId);
      else {
        const unsubscribed = await bounded(subscription.unsubscribe()).catch(() => false);
        if (revokeError && !unsubscribed) throw revokeError;
        if (unsubscribed) save(BROWSER_OWNER_KEY, null);
      }
    } else {
      save(BROWSER_OWNER_KEY, null);
    }
    save(OWNER_KEY, null);
    validatedEndpoint = null;
    if (boundaryError) throw boundaryError;
  });
}

export function unregisterPush(userId: string): Promise<void> {
  save(preferenceKey(userId), 'false');
  return detachPush(userId, false);
}

export async function enablePush(userId: string): Promise<boolean> {
  if (!pushSupported() || Notification.permission === 'denied') return false;
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return false;
  save(preferenceKey(userId), 'true');
  startPushSession(userId);
  return registerPush(userId);
}
