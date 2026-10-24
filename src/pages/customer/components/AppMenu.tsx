import Icon, { type IconName } from '@/components/feature/Icon';
import { lockBodyScroll } from '@/lib/bodyScrollLock';
import { useSignOut } from '@/hooks/useSignOut';
import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { openCookieSettings } from '@/lib/cookieConsent';

interface MenuItem {
  path: string;
  labelKey: string;
  icon: IconName;
}

export default function AppMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { logout: handleLogout, pending: loggingOut, error: logoutError } = useSignOut();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const trigger = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | null>(null);
  const stopClosing = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  useEffect(() => () => { if (closeTimer.current !== null) window.clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current, button = trigger.current;
    if (!element) return;
    const unlockScroll = lockBodyScroll();
    const viewport = window.visualViewport;
    const measure = () => {
      if (viewport && viewport.scale !== 1) return;
      element.style.setProperty('--menu-height', `${viewport?.height ?? window.innerHeight}px`);
      element.style.setProperty('--menu-top', `${viewport?.offsetTop ?? 0}px`);
    };
    measure(); element.showModal();
    viewport?.addEventListener('resize', measure); viewport?.addEventListener('scroll', measure);
    window.addEventListener('resize', measure);
    return () => {
      element.close(); unlockScroll();
      viewport?.removeEventListener('resize', measure); viewport?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      if (button?.isConnected) button.focus({ preventScroll: true });
    };
  }, [open]);

  const closeMenu = () => {
    if (closeTimer.current !== null) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setOpen(false); setClosing(false); return; }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null; setOpen(false); setClosing(false);
    }, 200);
  };

  const go = (path: string) => {
    stopClosing();
    setOpen(false);
    setClosing(false);
    navigate(path);
  };


  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  const mainItems: MenuItem[] = [
    { path: '/customer/home', labelKey: 'nav_home', icon: 'home' },
    { path: '/customer/orders', labelKey: 'nav_orders', icon: 'orders' },
    { path: '/customer/profile', labelKey: 'nav_profile', icon: 'user' },
    { path: '/customer/settings', labelKey: 'nav_settings', icon: 'settings' },
  ];

  const secondaryItems: MenuItem[] = [
    { path: '/contact', labelKey: 'menu_help', icon: 'help' },
    { path: '/privacy', labelKey: 'menu_privacy', icon: 'shield' },
    { path: '/terms', labelKey: 'menu_terms', icon: 'document' },
  ];

  const renderItem = (item: MenuItem) => {
    const active = location.pathname === item.path;
    return (
      <button
        key={item.path}
        type="button"
        data-route={item.path} onClick={() => go(item.path)}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors cursor-pointer text-left ${
          active ? 'bg-primary-50' : 'hover:bg-background-100'
        }`}
      >
        <span
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            active ? 'bg-primary-100' : 'bg-background-100'
          }`}
        >
          <Icon name={item.icon} className={`${active ? 'text-primary-600' : 'text-foreground-500'} text-lg`} />
        </span>
        <span
          className={`text-[15px] flex-1 whitespace-nowrap ${
            active ? 'font-semibold text-foreground-950' : 'font-medium text-foreground-800'
          }`}
        >
          {t(item.labelKey)}
        </span>
      </button>
    );
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const point = e.touches.length === 1 ? e.touches[0] : null;
    touchStart.current = point ? { x: point.clientX, y: point.clientY } : null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const point = e.changedTouches[0], start = touchStart.current;
    touchStart.current = null;
    if (!start || !point) return;
    const dx = point.clientX - start.x, dy = point.clientY - start.y;
    if (dx > 60 && dx > Math.abs(dy) * 1.5) closeMenu();
  };

  const drawer = open ? (
    <dialog ref={dialog} aria-label={t('menu_open')}
      onCancel={event => { event.preventDefault(); closeMenu(); }}
      style={{ top: 'var(--menu-top, 0px)', height: 'var(--menu-height, 100dvh)', bottom: 'auto' }}
      className="customer-app-menu fixed inset-0 z-[70] m-0 h-[100dvh] max-h-none w-full max-w-none border-0 bg-transparent p-0">
      <div
        className={`absolute inset-0 bg-black/40 ${
          closing ? 'animate-out fade-out duration-200' : 'animate-in fade-in duration-200'
        }`}
        onClick={closeMenu}
      />
      <aside
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`absolute right-0 top-0 h-full w-[86%] max-w-[360px] bg-white flex flex-col ${
          closing
            ? 'animate-out slide-out-to-right duration-200'
            : 'animate-in slide-in-from-right-6 duration-300'
        }`}
      >
        {/* Drawer header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 pt-3 pb-2"
          style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}
        >
          <span className="text-[16px] font-bold text-foreground-950 font-heading">
            {t('app_name')}
          </span>
          <button
            type="button"
            onClick={closeMenu}
            aria-label={t('cancel')}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer"
          >
            <Icon name="close" className="text-foreground-500 text-2xl" />
          </button>
        </div>

        {/* Profile */}
        <button
          type="button"
          data-route="/customer/profile" onClick={() => go('/customer/profile')}
          className="shrink-0 mx-5 mb-3 flex items-center gap-3 rounded-2xl bg-background-50 p-3 text-left cursor-pointer"
        >
          <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden flex-shrink-0">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="w-11 h-11 rounded-full object-cover" />
            ) : (
              <span className="text-[15px] font-bold text-primary-600 font-heading">{initials}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-foreground-950 truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-[13px] text-foreground-500 truncate">{user?.email}</p>
          </div>
        </button>

        {/* Main items */}
        <nav className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
          {mainItems.map(renderItem)}
          <div className="h-px bg-background-100 my-2" />
          {secondaryItems.map(renderItem)}
          <button type="button" className="w-full px-3 py-3 text-left text-[15px] text-foreground-800 underline cursor-pointer"
            onClick={() => { stopClosing(); setOpen(false); setClosing(false); openCookieSettings(); }}>
            {t('cookie_settings')}
          </button>
        </nav>

        {/* Logout */}
        <div
          className="shrink-0 px-4 py-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-red-600 hover:bg-red-50 transition-colors cursor-pointer text-left"
          >
            <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <Icon name="logout" className="text-red-500 text-lg" />
            </span>
            <span className="text-[15px] font-medium">{t('logout')}</span>
          </button>
          {logoutError && <p role="alert" className="text-xs text-red-600 px-3">{logoutError}</p>}
        </div>
      </aside>
    </dialog>
  ) : null;

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        ref={trigger} onClick={() => { stopClosing(); setClosing(false); setOpen(true); }}
        aria-label={t('menu_open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer"
      >
        <Icon name="menu" className="text-foreground-600 text-xl" />
      </button>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </>
  );
}
