import { useSignOut } from '@/hooks/useSignOut';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import NotificationBell from '@/components/feature/NotificationBell';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import { LOGO_URL } from '@/lib/logo';

interface AdminLayoutProps {
  title: string;
  children: React.ReactNode;
}

const sidebarLinks = [
  { icon: 'ri-dashboard-line', label: 'nav_dashboard', path: '/admin/dashboard', group: 'Работа днес' },
  { icon: 'ri-map-pin-line', label: 'Карта на живо', path: '/admin/map', group: 'Работа днес' },
  { icon: 'ri-file-list-3-line', label: 'Курсове и заявки', path: '/admin/orders', group: 'Работа днес' },
  { icon: 'ri-steering-line', label: 'nav_drivers', path: '/admin/drivers', group: 'Екип' },
  { icon: 'ri-car-line', label: 'nav_vehicles', path: '/admin/vehicles', group: 'Екип' },
  { icon: 'ri-bar-chart-line', label: 'Отчети и каса', path: '/admin/analytics', group: 'Финанси' },
  { icon: 'ri-money-dollar-circle-line', label: 'Цени', path: '/admin/pricing', group: 'Финанси' },
  { icon: 'ri-user-line', label: 'nav_customers', path: '/admin/customers', group: 'Управление' },
  { icon: 'ri-settings-line', label: 'nav_settings', path: '/admin/settings', group: 'Управление' },
  { icon: 'ri-building-2-line', label: 'Фирми', path: '/admin/companies', superOnly: true, group: 'Платформа' },
  { icon: 'ri-newspaper-line', label: 'Новини', path: '/admin/news', superOnly: true, group: 'Платформа' },
];

function AdminLayoutInner({ title, children, sidebarOpen, setSidebarOpen }: AdminLayoutProps & { sidebarOpen: boolean; setSidebarOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { logout, pending: loggingOut, error: logoutError } = useSignOut();
  const { companyId, companies, setCompanyId, companyName, error: companyError, reload } = useAdminCompany();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const platformPage = location.pathname === '/admin/companies' || location.pathname.startsWith('/admin/news');
  const roleTitle = isSuperAdmin ? 'Супер администратор' : 'Фирмен панел';
  const menuButton = useRef<HTMLButtonElement>(null);
  const links = sidebarLinks.filter(link => !link.superOnly || isSuperAdmin);
  useEffect(() => {
    if (!sidebarOpen) return;
    const trigger = menuButton.current;
    const drawer = document.getElementById('company-navigation');
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawer?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false);
      if (event.key !== 'Tab') return;
      const buttons = drawer?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
      if (!buttons?.length) return;
      const first = buttons[0]; const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const resize = () => { if (window.innerWidth >= 1024) setSidebarOpen(false); };
    window.addEventListener('keydown', close); window.addEventListener('resize', resize);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); window.removeEventListener('resize', resize); trigger?.focus(); };
  }, [sidebarOpen, setSidebarOpen]);

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Sidebar */}
      <aside
        id="company-navigation"
        aria-label="Фирмено меню"
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-white border-r border-background-200 transform transition-transform lg:translate-x-0 lg:sticky lg:top-0 lg:h-dvh lg:z-auto lg:visible ${
          sidebarOpen ? 'translate-x-0 visible' : '-translate-x-full invisible'
        }`}
      >
        <div className="p-5 border-b border-background-100 shrink-0">
          <div className="flex items-center gap-2.5 mb-2">
            <img
              src={LOGO_URL}
              alt="Лески Каручка"
              className="h-8 w-auto rounded"
            />
            <h1 className="flex-1 min-w-0 break-words text-lg font-bold text-foreground-950 font-heading leading-tight">
              {roleTitle}
            </h1>
            <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Затвори навигацията" className="ml-auto lg:hidden rounded-lg p-2 hover:bg-background-100"><i className="ri-close-line" aria-hidden="true" /></button>
          </div>
          <p className="text-xs text-foreground-500 mt-0.5">
            {user?.first_name} {user?.last_name}
          </p>
          <p className="text-xs text-foreground-600 mt-2 break-words">
            {platformPage ? 'Управление на платформата' : companyName ? `Управляваш: ${companyName}` : 'Няма избрана фирма'}
          </p>
        </div>
        <nav className="p-3 flex-1 min-h-0 overflow-y-auto" aria-label="Основна навигация">
          {[...new Set(links.map(link => link.group))].map(group => <div key={group} className="mb-4">
          <p className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider uppercase text-foreground-400">{group}</p>
          {links.filter(link => link.group === group).map((link) => {
            const label = link.label.startsWith('nav_') ? t(link.label) : link.label;
            return (
              <button
                key={link.path}
                type="button"
                aria-current={location.pathname === link.path ? 'page' : undefined}
                onClick={() => {
                  navigate(link.path);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap text-left ${
                  location.pathname === link.path
                    ? 'bg-primary-500 text-white'
                    : 'text-foreground-600 hover:bg-background-100'
                }`}
              >
                <i className={`${link.icon} text-lg`} />
                <span>{label}</span>
              </button>
            );
          })}</div>)}
        </nav>
        <div className="shrink-0 p-3 border-t border-background-100">
          <button
            onClick={logout}
            disabled={loggingOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-logout-box-line text-lg" />
            <span>{t('logout')}</span>
          </button>
          {logoutError && <p role="alert" className="text-xs text-red-600 px-3">{logoutError}</p>}
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0" inert={sidebarOpen || undefined}>
        {/* Top bar */}
        <header className="bg-white border-b border-background-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={sidebarOpen ? 'Затвори менюто' : 'Отвори менюто'}
              aria-expanded={sidebarOpen}
              aria-controls="company-navigation"
              ref={menuButton}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
            >
              <i className="ri-menu-line text-foreground-600 text-lg" />
            </button>
            <div><h1 className="lg:hidden text-[10px] text-foreground-500 font-semibold">{roleTitle}</h1><h2 className="text-base font-semibold text-foreground-950 font-heading">{title}</h2></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isSuperAdmin && !platformPage && companies.length > 0 && (
              <div className="relative">
                <label htmlFor="admin-company" className="sr-only">Управлявана фирма</label>
                <select
                  id="admin-company"
                  value={companyId || ''}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="pl-8 pr-8 py-2 rounded-lg bg-background-50 border border-background-200 text-sm font-medium text-foreground-800 focus:outline-none focus:ring-2 focus:ring-primary-200 cursor-pointer appearance-none"
                >
                  <option value="" disabled>
                    Избери фирма
                  </option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.is_active === false ? ' (неактивна)' : ''}
                    </option>
                  ))}
                </select>
                <i className="ri-building-2-line absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                <i className="ri-arrow-down-s-line absolute right-2 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
              </div>
            )}
            <NotificationBell />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 md:p-6">{companyError && <div role="alert" className="mb-4 text-sm text-red-600">{companyError} <button className="underline" onClick={reload}>Опитай отново</button></div>}{children}</main>
      </div>
    </div>
  );
}

export default function AdminLayout({ title, children }: AdminLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  return (
    <AdminLayoutInner title={title} sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}>
      {children}
    </AdminLayoutInner>
  );
}
