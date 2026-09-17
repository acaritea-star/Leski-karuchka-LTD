import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';

interface MenuItem {
  path: string;
  labelKey: string;
  icon: string;
}

export default function AppMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Lock background scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const closeMenu = () => {
    setClosing(true);
    window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 200);
  };

  const go = (path: string) => {
    setOpen(false);
    setClosing(false);
    navigate(path);
  };

  const handleLogout = async () => {
    setOpen(false);
    setClosing(false);
    await signOut();
    navigate('/');
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  const mainItems: MenuItem[] = [
    { path: '/customer/home', labelKey: 'nav_home', icon: 'ri-home-4-line' },
    { path: '/customer/orders', labelKey: 'nav_orders', icon: 'ri-file-list-3-line' },
    { path: '/customer/profile', labelKey: 'nav_profile', icon: 'ri-user-3-line' },
    { path: '/customer/settings', labelKey: 'nav_settings', icon: 'ri-settings-3-line' },
  ];

  const secondaryItems: MenuItem[] = [
    { path: '/contact', labelKey: 'menu_help', icon: 'ri-question-line' },
    { path: '/privacy', labelKey: 'menu_privacy', icon: 'ri-shield-check-line' },
  ];

  const renderItem = (item: MenuItem) => {
    const active = location.pathname === item.path;
    return (
      <button
        key={item.path}
        type="button"
        onClick={() => go(item.path)}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors cursor-pointer text-left ${
          active ? 'bg-primary-50' : 'hover:bg-background-100'
        }`}
      >
        <span
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            active ? 'bg-primary-100' : 'bg-background-100'
          }`}
        >
          <i className={`${item.icon} ${active ? 'text-primary-600' : 'text-foreground-500'} text-lg`} />
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
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current !== null) {
      const dx = e.changedTouches[0].clientX - touchStartX.current;
      if (dx > 60) closeMenu();
      touchStartX.current = null;
    }
  };

  const drawer = open ? (
    <div className="fixed inset-0 z-[70]">
      <div
        className={`absolute inset-0 bg-black/40 ${
          closing ? 'animate-out fade-out duration-200' : 'animate-in fade-in duration-200'
        }`}
        onClick={closeMenu}
      />
      <aside
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`absolute right-0 top-0 h-[100dvh] w-[86%] max-w-[360px] bg-white flex flex-col ${
          closing
            ? 'animate-out slide-out-to-right duration-200'
            : 'animate-in slide-in-from-right-6 duration-300'
        }`}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-5 pt-3 pb-2"
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
            <i className="ri-close-line text-foreground-500 text-2xl" />
          </button>
        </div>

        {/* Profile */}
        <button
          type="button"
          onClick={() => go('/customer/profile')}
          className="mx-5 mb-3 flex items-center gap-3 rounded-2xl bg-background-50 p-3 text-left cursor-pointer"
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
        <nav className="flex-1 overflow-y-auto px-4 py-2">
          {mainItems.map(renderItem)}
          <div className="h-px bg-background-100 my-2" />
          {secondaryItems.map(renderItem)}
        </nav>

        {/* Logout */}
        <div
          className="px-4 py-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-red-600 hover:bg-red-50 transition-colors cursor-pointer text-left"
          >
            <span className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
              <i className="ri-logout-box-r-line text-red-500 text-lg" />
            </span>
            <span className="text-[15px] font-medium">{t('logout')}</span>
          </button>
        </div>
      </aside>
    </div>
  ) : null;

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('menu_open')}
        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer"
      >
        <i className="ri-menu-line text-foreground-600 text-xl" />
      </button>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </>
  );
}