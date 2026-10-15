import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from './requestTimeout';

const OWNER_KEY = 'leski_push_owner';
const preferenceKey = (userId: string) => `leski_push_enabled:${userId}`;
let owner: string | null = null;
let revision = 0;
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
  const value = localStorage.getItem(preferenceKey(userId)) ?? localStorage.getItem('leski_notifications_enabled');
  return value === 'false' ? false : value === 'true' ? true : null;
}
const allowed = (userId: string) => pushSupported() && Notification.permission === 'granted'
  && !suspended.has(userId)
  && (localStorage.getItem(preferenceKey(userId)) ?? localStorage.getItem('leski_notifications_enabled')) !== 'false';

export function registerPush(userId: string): Promise<boolean> {
  const started = revision;
  return serialized(async () => {
    const stillCurrent = () => started === revision && allowed(userId);
    if (!stillCurrent()) return false;
    const { data } = await bounded(supabase.auth.getSession());
    if (data.session?.user.id !== userId || !stillCurrent()) return false;
    if (owner === userId) return true;
    await bounded(navigator.serviceWorker.register('/sw.js'));
    const registration = await bounded(navigator.serviceWorker.ready);
    if (!stillCurrent()) return false;
    let subscription = await bounded(registration.pushManager.getSubscription());
    // A shared browser must not reuse the previous account's delivery endpoint.
    if (subscription && localStorage.getItem(OWNER_KEY) !== userId) {
      if (!await bounded(subscription.unsubscribe())) throw new Error('Could not release old subscription');
      subscription = null;
    }
    if (!subscription) {
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
    const body = {
      p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent,
    };
    const { error } = await withRequestTimeout(signal => supabase.rpc('register_push_subscription', body).abortSignal(signal));
    if (error) throw error;
    localStorage.setItem(OWNER_KEY, userId);
    if (!stillCurrent()) return false;
    setOwner(userId);
    return true;
  });
}

/** A verified new login resumes delivery without changing the saved choice. */
export function startPushSession(userId: string) { suspended.delete(userId); }

/** Logout releases this device. Only the settings switch records an opt-out. */
export function detachPush(userId: string): Promise<void> {
  revision++;
  suspended.add(userId);
  if (owner === userId) setOwner(null);
  return serialized(async () => {
    if (!('serviceWorker' in navigator)) return;
    const registration = await bounded(navigator.serviceWorker.getRegistration('/'));
    if (!registration) return;
    const registeredOwner = localStorage.getItem(OWNER_KEY);
    if (registeredOwner && registeredOwner !== userId) return;
    const subscription = await bounded(registration.pushManager.getSubscription());
    if (!subscription) return;
    const unsubscribed = await bounded(subscription.unsubscribe()).catch(() => false);
    const { error } = await withRequestTimeout(signal => supabase.from('push_subscriptions').delete()
      .eq('user_id', userId).eq('endpoint', subscription.endpoint).abortSignal(signal));
    if (error && !unsubscribed) { setOwner(userId); throw error; }
    localStorage.removeItem(OWNER_KEY);
  });
}

export function unregisterPush(userId: string): Promise<void> {
  localStorage.setItem(preferenceKey(userId), 'false');
  return detachPush(userId);
}

export async function enablePush(userId: string): Promise<boolean> {
  if (!pushSupported() || Notification.permission === 'denied') return false;
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return false;
  localStorage.setItem(preferenceKey(userId), 'true');
  startPushSession(userId);
  return registerPush(userId);
}
