import { supabase } from '@/lib/supabase';

interface PushOptions {
  icon?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  renotify?: boolean;
  vibrate?: number[];
}

/**
 * Send a push notification to a specific user via Edge Function.
 * Works even when the user's phone is locked / app is closed.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  options: PushOptions = {},
): Promise<{ sent: number; failed: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        user_id: userId,
        title,
        body,
        icon: options.icon || '/icon-192.png',
        tag: options.tag || 'taxi-notification',
        data: options.data || {},
        requireInteraction: options.requireInteraction ?? false,
        renotify: options.renotify ?? true,
        vibrate: options.vibrate || [200, 100, 200],
      },
    });

    if (error) {
      console.error('[Push] Edge Function error:', error);
      return null;
    }

    
    return data as { sent: number; failed: number } | null;
  } catch (err) {
    console.error('[Push] Failed to send:', err);
    return null;
  }
}

/**
 * Broadcast a push notification to ALL online drivers in a company.
 * Use this when a new taxi request is created.
 */
export async function broadcastPushToDrivers(
  companyId: string,
  title: string,
  body: string,
  options: PushOptions = {},
): Promise<{ sent: number; failed: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('send-push-notification', {
      body: {
        company_id: companyId,
        title,
        body,
        icon: options.icon || '/icon-192.png',
        tag: options.tag || 'taxi-new-request',
        data: { type: 'new_request', role: 'DRIVER', ...options.data },
        requireInteraction: options.requireInteraction ?? true,
        renotify: true,
        vibrate: options.vibrate || [300, 100, 300, 100, 300, 100, 500],
      },
    });

    if (error) {
      console.error('[Push Broadcast] Edge Function error:', error);
      return null;
    }

    
    return data as { sent: number; failed: number } | null;
  } catch (err) {
    console.error('[Push Broadcast] Failed:', err);
    return null;
  }
}