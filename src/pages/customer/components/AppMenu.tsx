import { useState, useEffect } from 'react';
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
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors cursor-pointer text-left ${
          active ? 'bg-primary-50' : 'hover:bg-background-100'
        }`}
      >
        <span
          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
            active ? 'bg-primary-100' : 'bg-background-100'
          }`}
        >
          <i className={`${item.icon} ${active ? 'text-primary-600' : 'text-foreground-500'} text-lg`} />
        </span>
        <span
          className={`text-sm flex-1 whitespace-nowrap ${
            active ? 'font-semibold text-foreground-950' : 'font-medium text-foreground-800'
          }`}
        >
          {t(item.labelKey)}
        </span>
        <i className="ri-arrow-right-s-line text-foreground-400 text-lg" />
      </button>
    );
  };

  return (
    <>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('menu_open')}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-white/80 backdrop-blur hover:bg-white transition-colors cursor-pointer border border-background-200"
      >
        <i className="ri-menu-line text-foreground-600 text-lg" />
      </button>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-[70]">
          <div
            className={`absolute inset-0 bg-black/40 ${closing ? 'animate-out fade-out duration-200' : 'animate-in fade-in duration-200'}`}
            onClick={closeMenu}
          />
          <aside
            className={`absolute right-0 top-0 h-full w-[86%] max-w-sm bg-background-50 flex flex-col shadow-2xl ${
              closing
                ? 'animate-out slide-out-to-right duration-200'
                : 'animate-in slide-in-from-right-6 duration-300'
            }`}
          >
            {/* Drawer header */}
            <div className="px-5 pt-5 pb-5 border-b border-background-100">
              <div className="flex items-center justify-between mb-4">
                <span className="text-base font-bold text-foreground-950 font-heading">
                  {t('app_name')}
                </span>
                <button
                  type="button"
                  onClick={closeMenu}
                  aria-label={t('cancel')}
                  className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer"
                >
                  <i className="ri-close-line text-foreground-500 text-xl" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => go('/customer/profile')}
                className="w-full flex items-center gap-3 text-left cursor-pointer"
              >
                <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {user?.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-bold text-primary-600 font-heading">
                      {initials}
                    </span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground-950 truncate">
                    {user?.first_name} {user?.last_name}
                  </p>
                  <p className="text-xs text-foreground-500 truncate">{user?.email}</p>
                </div>
              </button>
            </div>

            {/* Main items */}
            <nav className="flex-1 overflow-y-auto px-3 py-3">
              {mainItems.map(renderItem)}

              <div className="h-px bg-background-100 my-2 mx-3" />

              {secondaryItems.map(renderItem)}
            </nav>

            {/* Logout */}
            <div className="p-4 border-t border-background-100">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-3 rounded-xl bg-red-50 text-red-500 font-semibold text-sm hover:bg-red-100 transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <i className="ri-logout-box-r-line text-base" />
                {t('logout')}
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}