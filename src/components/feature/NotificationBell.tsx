import { useState, useEffect, useLayoutEffect, useId, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/contexts/NotificationsContext';
import { notificationPath, notificationAudience } from '@/lib/notifications';
import { useAuth } from '@/hooks/useAuth';

export default function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const inbox = useNotifications();
  const { unread, items: notifications, loading, loadError: fetchError, writeError, marking, markRead: markAllRead, watchHistory } = inbox;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState({ left: 12, top: 76, width: 296, maxHeight: 420 });
  useEffect(() => { if (open) return watchHistory(); }, [open, watchHistory]);
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
            <div><h3 className="text-sm font-semibold text-foreground-950 font-heading">{t('notifications_title')}</h3><p className="text-xs text-foreground-500">{t('notifications_for_' + notificationAudience(user?.role))}</p></div>
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
              {fetchError && <button type="button" disabled={loading} className="min-h-11 underline" onClick={inbox.retry}>{t('retry')}</button>}
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
                    className={`${!n.is_read ? 'bg-accent-50/50' : ''}`}
                  ><button type="button" onClick={() => { close(); navigate(notificationPath(n.id)); }} className="w-full px-4 py-3 flex gap-3 text-left hover:bg-background-50">
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
                  </button></li>
                ))}
              </ul>
            )}
            {inbox.hasMore && <button type="button" disabled={loading} onClick={inbox.loadMore} className="w-full min-h-11 text-sm text-accent-700 underline">{t('notifications_more')}</button>}
          </div>
          <button type="button" className="shrink-0 min-h-11 px-4 text-left text-sm text-accent-700 border-t border-background-100" onClick={() => { close(); navigate(user?.role === 'DRIVER' ? '/driver/profile' : user?.role === 'CUSTOMER' ? '/customer/settings' : '/admin/settings'); }}>{t('nav_settings')}</button>
        </div>, document.body
      )}
    </div>
  );
}
