import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { sendPushToUser } from '@/lib/push';
import { usePushNotifications } from '@/hooks/usePushNotifications';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export default function NotificationBell() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { playCustomerSound, unlockAudio } = useNotificationSound();
  const { register } = usePushNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const unread = notifications.filter((n) => !n.is_read).length;

  // Register for push notifications on mount
  useEffect(() => {
    if (user?.id) {
      register(user.id);
    }
  }, [user?.id, register]);

  // Unlock audio on first user interaction (required by browsers)
  useEffect(() => {
    const handler = () => {
      unlockAudio();
    };
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [unlockAudio]);

  const fetchNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, message, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      setNotifications((data || []) as Notification[]);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          // Play soft customer chime for every new notification
          playCustomerSound();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, playCustomerSound]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markAllRead = async () => {
    if (!user?.id) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true }).in('id', unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('time_just_now');
    if (minutes < 60) return t('time_minutes', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time_hours', { n: hours });
    const days = Math.floor(hours / 24);
    return t('time_days', { n: days });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer"
      >
        <i className="ri-notification-3-line text-foreground-600 text-lg" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-[320px] max-w-[85vw] bg-white rounded-2xl border border-background-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between px-4 py-3 border-b border-background-100">
            <h3 className="text-sm font-semibold text-foreground-950 font-heading">{t('notifications_title')}</h3>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-accent-600 font-medium hover:text-accent-700 transition-colors cursor-pointer whitespace-nowrap"
              >
                {t('notifications_mark_all_read')}
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <div className="text-center py-10">
                <i className="ri-notification-off-line text-2xl text-foreground-300" />
                <p className="text-sm text-foreground-400 mt-2">{t('notifications_empty')}</p>
              </div>
            ) : (
              <div className="divide-y divide-background-100">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 flex gap-3 cursor-pointer transition-colors hover:bg-background-50 ${!n.is_read ? 'bg-accent-50/50' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${!n.is_read ? 'bg-accent-100' : 'bg-background-100'}`}>
                      <i className={`${n.type === 'new_request' ? 'ri-taxi-line' : 'ri-map-pin-2-line'} ${!n.is_read ? 'text-accent-600' : 'text-foreground-400'} text-sm`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-foreground-900 truncate">{n.title}</p>
                        <span className="text-[11px] text-foreground-400 flex-shrink-0">{formatTime(n.created_at)}</span>
                      </div>
                      <p className="text-xs text-foreground-500 mt-0.5 line-clamp-2">{n.message}</p>
                    </div>
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0 mt-1.5" />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}