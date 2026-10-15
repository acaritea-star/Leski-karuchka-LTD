import type { AppUser } from '@/hooks/useAuth';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';

export type NotificationAudience = 'customer' | 'driver' | 'company';
export type InboxItem = {
  id: string; audience: NotificationAudience; type: string; title: string; message: string;
  is_read: boolean; created_at: string; priority: string; expires_at: string | null;
};
export type InboxState = { unread: number; latest_id: string | null };
export const notificationAudience = (role?: AppUser['role']): NotificationAudience | null =>
  role === 'CUSTOMER' ? 'customer' : role === 'DRIVER' ? 'driver' : role ? 'company' : null;
export async function readInboxState(signal: AbortSignal): Promise<InboxState> {
  const { data, error } = await supabase.rpc('notification_inbox_state').abortSignal(signal);
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.unread !== 'number') throw new Error('Invalid inbox response');
  return { unread: Math.max(0, data.unread), latest_id: typeof data.latest_id === 'string' ? data.latest_id : null };
}
export async function readInboxPage(last?: InboxItem) {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('notification_inbox_page', {
    p_before: last?.created_at, p_before_id: last?.id,
  }).abortSignal(signal));
  if (error) throw error;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.items)) throw new Error('Invalid inbox response');
  return { items: data.items as unknown as InboxItem[], has_more: data.has_more === true };
}
export const notificationPath = (id: string) => '/notifications/open?id=' + encodeURIComponent(id);
