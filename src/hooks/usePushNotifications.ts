import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface PushSubscriptionJSON {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

const VAPID_KEY_CACHE_KEY = 'leski_vapid_public_key';

/**
 * Fetch VAPID public key from Edge Function.
 * Keys are now stable on the server, so caching is safe.
 */
async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const cached = localStorage.getItem(VAPID_KEY_CACHE_KEY);
    if (cached) {
      
      return cached;
    }

    
    const { data, error } = await supabase.functions.invoke('generate-vapid-keys', {});
    

    if (error || !data?.publicKey) {
      console.warn('[Push] Failed to fetch VAPID key:', error, data);
      return null;
    }

    localStorage.setItem(VAPID_KEY_CACHE_KEY, data.publicKey);
    
    return data.publicKey;
  } catch (err) {
    console.warn('[Push] VAPID fetch error:', err);
    return null;
  }
}

/**
 * Subscribe to Web Push using the already-granted permission and store the
 * subscription in Supabase.
 */
async function registerPush(userId: string): Promise<PushSubscriptionJSON | null> {
  

  if (!('serviceWorker' in navigator)) {
    console.warn('[Push] Service Workers not supported');
    return null;
  }
  if (!('PushManager' in window)) {
    console.warn('[Push] Push API not supported');
    return null;
  }

  

  const vapidPublicKey = await fetchVapidPublicKey();
  if (!vapidPublicKey) {
    console.warn('[Push] VAPID public key not available');
    return null;
  }

  

  try {
    
    const registration = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    

    let subscription = await registration.pushManager.getSubscription();
    

    if (!subscription) {
      if (Notification.permission !== 'granted') {
        console.warn('[Push] Permission not granted yet — cannot subscribe');
        return null;
      }

      
      const appServerKey = urlBase64ToUint8Array(vapidPublicKey);
      

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });
      
    }

    const subJson = subscription.toJSON() as PushSubscriptionJSON;
    

    
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: userId,
          endpoint: subJson.endpoint,
          p256dh: subJson.keys.p256dh,
          auth: subJson.keys.auth,
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,endpoint' },
      );

    if (error) {
      console.error('[Push] Failed to save subscription:', error);
      return null;
    }

    
    return subJson;
  } catch (err) {
    console.error('[Push] Registration failed:', err);
    return null;
  }
}

async function unregisterPush(userId: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
    }

    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId);

    
  } catch (err) {
    console.error('[Push] Unregister failed:', err);
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(Array.prototype.map.call(rawData, (ch) => ch.charCodeAt(0)) as number[]);
}

export function usePushNotifications() {
  const registeredRef = useRef(false);
  const [permission, setPermission] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  const register = useCallback(async (userId: string) => {
    if (registeredRef.current) return;
    const result = await registerPush(userId);
    if (result) {
      registeredRef.current = true;
    }
  }, []);

  const enable = useCallback(async (userId: string): Promise<boolean> => {
    
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      console.warn('[Push] Web Push not supported on this device');
      return false;
    }

    
    setEnabling(true);
    try {
      
      const perm = await Notification.requestPermission();
      
      setPermission(perm);
      if (perm !== 'granted') {
        console.warn('[Push] Permission denied or dismissed');
        return false;
      }
      const result = await registerPush(userId);
      if (result) {
        registeredRef.current = true;
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Push] Enable failed:', err);
      return false;
    } finally {
      setEnabling(false);
    }
  }, []);

  const unregister = useCallback(async (userId: string) => {
    registeredRef.current = false;
    await unregisterPush(userId);
  }, []);

  useEffect(() => {
    const checkAndRegister = async () => {
      if (!('Notification' in window)) {
        console.warn('[Push] Notification API not available in this browser');
        return;
      }
      setPermission(Notification.permission);
      if (Notification.permission !== 'granted') return;
      const { data } = await supabase.auth.getSession();
      const userId = data?.session?.user?.id;
      if (userId && !registeredRef.current) {
        const result = await registerPush(userId);
        if (result) {
          registeredRef.current = true;
        }
      }
    };
    checkAndRegister();
  }, []);

  return { register, unregister, enable, permission, enabling };
}