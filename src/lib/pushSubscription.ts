import { supabase } from '@/lib/supabase';

const OWNER_KEY = 'leski_push_owner';
const preferenceKey = (userId: string) => `leski_push_enabled:${userId}`;
let owner: string | null = null;
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
const allowed = (userId: string) => pushSupported() && Notification.permission === 'granted'
  && (localStorage.getItem(preferenceKey(userId)) ?? localStorage.getItem('leski_notifications_enabled')) !== 'false';

export function registerPush(userId: string): Promise<boolean> {
  return serialized(async () => {
    if (!allowed(userId)) return false;
    const { data } = await bounded(supabase.auth.getSession());
    if (data.session?.user.id !== userId || !allowed(userId)) return false;
    if (owner === userId) return true;
    await bounded(navigator.serviceWorker.register('/sw.js'));
    const registration = await bounded(navigator.serviceWorker.ready);
    if (!allowed(userId)) return false;
    let subscription = await bounded(registration.pushManager.getSubscription());
    // A shared browser must not reuse the previous account's delivery endpoint.
    if (subscription && localStorage.getItem(OWNER_KEY) !== userId) {
      if (!await bounded(subscription.unsubscribe())) throw new Error('Could not release old subscription');
      subscription = null;
    }
    if (!subscription) {
      const { data: vapid, error } = await bounded(supabase.functions.invoke('generate-vapid-keys'));
      if (error || !vapid?.publicKey) throw new Error('Push key unavailable');
      if (!allowed(userId)) return false;
      const key = Uint8Array.from(atob(vapid.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      subscription = await bounded(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    }
    if (!allowed(userId)) return false;
    const { data: current } = await bounded(supabase.auth.getSession());
    if (current.session?.user.id !== userId) return false;
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys) throw new Error('Invalid browser subscription');
    const { error } = await supabase.rpc('register_push_subscription', {
      p_endpoint: json.endpoint, p_p256dh: json.keys.p256dh, p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent,
    }).abortSignal(AbortSignal.timeout(10000));
    if (error) throw error;
    localStorage.setItem(OWNER_KEY, userId);
    if (!allowed(userId)) return false;
    setOwner(userId);
    return true;
  });
}

export function unregisterPush(userId: string): Promise<void> {
  // Set before waiting: an in-flight registration cannot re-enable delivery.
  localStorage.setItem(preferenceKey(userId), 'false');
  setOwner(null);
  return serialized(async () => {
    if (!('serviceWorker' in navigator)) return;
    const registration = await bounded(navigator.serviceWorker.getRegistration('/'));
    if (!registration) return;
    const subscription = await bounded(registration.pushManager.getSubscription());
    if (!subscription) return;
    const unsubscribed = await bounded(subscription.unsubscribe()).catch(() => false);
    const { error } = await supabase.from('push_subscriptions').delete()
      .eq('user_id', userId).eq('endpoint', subscription.endpoint).abortSignal(AbortSignal.timeout(10000));
    if (error && !unsubscribed) { setOwner(userId); throw error; }
    localStorage.removeItem(OWNER_KEY);
  });
}

export async function enablePush(userId: string): Promise<boolean> {
  if (!pushSupported() || await Notification.requestPermission() !== 'granted') return false;
  localStorage.setItem(preferenceKey(userId), 'true');
  return registerPush(userId);
}
