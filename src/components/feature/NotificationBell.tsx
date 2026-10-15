import { useState, useEffect, useLayoutEffect, useId, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { withRequestTimeout } from '@/lib/requestTimeout';

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
  const [fetchError, setFetchError] = useState(false);
  const [writeError, setWriteError] = useState(false);
  const [marking, setMarking] = useState(false);
  const markingRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const owner = useRef(user?.id); owner.current = user?.id;
  const [position, setPosition] = useState({ left: 12, top: 76, width: 296, maxHeight: 420 });
  const fetchSequence = useRef(0);
  const cancelPendingFetch = useCallback(() => { fetchSequence.current++; }, []);

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
    const sequence = ++fetchSequence.current;
    setLoading(true);
    try {
      const { data, error } = await withRequestTimeout(signal => supabase
        .from('notifications')
        .select('id, type, title, message, is_read, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .abortSignal(signal).limit(30), 10_000);

      if (error) throw error;
      if (sequence === fetchSequence.current) { setNotifications((data || []) as Notification[]); setFetchError(false); }
    } catch (err) {
      console.error('Error fetching notifications:', err);
      if (sequence === fetchSequence.current) setFetchError(true);
    } finally {
      if (sequence === fetchSequence.current) setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    setNotifications([]);
    setFetchError(false); setWriteError(false);
    void fetchNotifications();
    const reconcile = () => {
      if (document.visibilityState !== 'hidden') void fetchNotifications();
    };
    const interval = user?.id ? setInterval(reconcile, 30_000) : null;
    window.addEventListener('online', reconcile);
    window.addEventListener('focus', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    return () => {
      cancelPendingFetch();
      if (interval) clearInterval(interval);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('focus', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
    };
  }, [fetchNotifications, user?.id, cancelPendingFetch]);

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
          setNotifications((prev) => [newNotif, ...prev.filter(n => n.id !== newNotif.id)].slice(0, 30));
          // Play soft customer chime for every new notification
          playCustomerSound();
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void fetchNotifications();
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, playCustomerSound, fetchNotifications]);

  const close = useCallback(() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const viewport = window.visualViewport, bounds = trigger.current?.getBoundingClientRect();
      const x = viewport?.offsetLeft ?? 0, y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      const panelWidth = Math.min(360, width - 24);
      const top = Math.max(y + 12, Math.min((bounds?.bottom ?? y + 64) + 8, y + height - 180));
      setPosition({ left: Math.max(x + 12, Math.min((bounds?.right ?? width - 12) - panelWidth, x + width - panelWidth - 12)), top, width: panelWidth, maxHeight: Math.max(80, y + height - top - 12) });
    };
    const outside = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) measure(); };
    measure(); panel.current?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    window.addEventListener('resize', measure); window.addEventListener('scroll', scroll, true);
    window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', scroll, true);
      window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [open, close]);

  const markAllRead = async () => {
    if (!user?.id || markingRef.current) return;
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    const account = user.id;
    markingRef.current = true; setMarking(true); setWriteError(false);
    try {
      const { data, error } = await withRequestTimeout(signal => supabase.from('notifications').update({ is_read: true })
        .eq('user_id', account).in('id', unreadIds).select('id').abortSignal(signal), 10_000);
      if (error || !data?.length) throw error || new Error('Unconfirmed update');
      if (owner.current !== account) return;
      cancelPendingFetch(); setLoading(false);
      const confirmed = new Set(data.map(row => row.id));
      setNotifications(prev => prev.map(n => confirmed.has(n.id) ? { ...n, is_read: true } : n));
    } catch {
      if (owner.current === account) setWriteError(true);
    } finally { markingRef.current = false; if (owner.current === account) setMarking(false); }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr).getTime();
    if (!Number.isFinite(date)) return '';
    const diff = Math.max(0, Date.now() - date);
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t('time_just_now');
    if (minutes < 60) return t('time_minutes', { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('time_hours', { n: hours });
    const days = Math.floor(hours / 24);
    return t('time_days', { n: days });
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={trigger} type="button" aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        aria-label={t('notifications_title')}
        aria-expanded={open}
        className="relative w-11 h-11 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer"
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div id={panelId} ref={panel} role="dialog" aria-label={t('notifications_title')} tabIndex={-1} style={position}
          className="fixed flex flex-col bg-white rounded-2xl border border-background-200 shadow-xl overflow-hidden z-[65]">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-background-100">
            <h3 className="text-sm font-semibold text-foreground-950 font-heading">{t('notifications_title')}</h3>
            <button type="button" aria-label={t('notifications_close')} onClick={close} className="w-11 h-11 ml-auto shrink-0 flex items-center justify-center rounded-xl hover:bg-background-100">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
            {unread > 0 && (
              <button
                type="button" disabled={marking} aria-busy={marking} aria-label={t('notifications_mark_all_read')}
                onClick={markAllRead}
                className="w-full min-h-11 text-left text-xs text-accent-600 font-medium hover:text-accent-700 transition-colors disabled:opacity-50"
              >
                {marking ? t('loading') : t('notifications_mark_all_read')}
              </button>
            )}
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain">
            {(fetchError || writeError) && <div role="alert" className="p-4 text-sm text-red-600 break-words">
              <p>{t(fetchError ? 'notifications_load_error' : 'notifications_read_error')}</p>
              {fetchError && <button type="button" disabled={loading} className="min-h-11 underline" onClick={() => void fetchNotifications()}>{t('retry')}</button>}
            </div>}
            {loading && notifications.length === 0 ? (
              <div role="status" aria-label={t('loading')} className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 && !fetchError ? (
              <div className="text-center py-10">
                <i className="ri-notification-off-line text-2xl text-foreground-300" />
                <p className="text-sm text-foreground-400 mt-2">{t('notifications_empty')}</p>
              </div>
            ) : (
              <ul className="divide-y divide-background-100">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`px-4 py-3 flex gap-3 ${!n.is_read ? 'bg-accent-50/50' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${!n.is_read ? 'bg-accent-100' : 'bg-background-100'}`}>
                      <i className={`${n.type === 'new_request' ? 'ri-taxi-line' : 'ri-map-pin-2-line'} ${!n.is_read ? 'text-accent-600' : 'text-foreground-400'} text-sm`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-sm font-medium text-foreground-900 break-words">{n.title}</p>
                        <span className="text-[11px] text-foreground-400 flex-shrink-0">{formatTime(n.created_at)}</span>
                      </div>
                      <p className="text-xs text-foreground-500 mt-0.5 break-words">{n.message}</p>
                    </div>
                    {!n.is_read && (
                      <div className="w-2 h-2 rounded-full bg-accent-500 flex-shrink-0 mt-1.5" />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>, document.body
      )}
    </div>
  );
}
