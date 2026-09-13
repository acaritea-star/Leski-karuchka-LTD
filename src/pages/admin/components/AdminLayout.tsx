import { useState } from 'react';
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
  { icon: 'ri-dashboard-line', label: 'nav_dashboard', path: '/admin/dashboard' },
  { icon: 'ri-building-2-line', label: 'Фирми', path: '/admin/companies' },
  { icon: 'ri-map-pin-line', label: 'Карта на живо', path: '/admin/map' },
  { icon: 'ri-steering-line', label: 'nav_drivers', path: '/admin/drivers' },
  { icon: 'ri-car-line', label: 'nav_vehicles', path: '/admin/vehicles' },
  { icon: 'ri-user-line', label: 'nav_customers', path: '/admin/customers' },
  { icon: 'ri-file-list-3-line', label: 'nav_orders', path: '/admin/orders' },
  { icon: 'ri-money-dollar-circle-line', label: 'Цени', path: '/admin/pricing' },
  { icon: 'ri-bar-chart-line', label: 'nav_analytics', path: '/admin/analytics' },
  { icon: 'ri-newspaper-line', label: 'Новини', path: '/admin/news' },
  { icon: 'ri-settings-line', label: 'nav_settings', path: '/admin/settings' },
];

function AdminLayoutInner({ title, children, sidebarOpen, setSidebarOpen }: AdminLayoutProps & { sidebarOpen: boolean; setSidebarOpen: (v: boolean) => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { companyId, companies, setCompanyId, companyName } = useAdminCompany();

  return (
    <div className="min-h-screen bg-background-50 flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-background-200 transform transition-transform lg:translate-x-0 lg:static lg:z-auto ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-5 border-b border-background-100">
          <div className="flex items-center gap-2.5 mb-2">
            <img
              src={LOGO_URL}
              alt="Лески Каручка"
              className="h-8 w-auto rounded"
            />
            <h1 className="text-lg font-bold text-foreground-950 font-heading truncate">
              {companyName || 'Админ панел'}
            </h1>
          </div>
          <p className="text-xs text-foreground-500 mt-0.5">
            {user?.first_name} {user?.last_name}
          </p>
        </div>
        <nav className="p-3 flex flex-col gap-1">
          {sidebarLinks.map((link) => {
            const label = link.label.startsWith('nav_') ? t(link.label) : link.label;
            return (
              <button
                key={link.path}
                onClick={() => {
                  navigate(link.path);
                  setSidebarOpen(false);
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap text-left ${
                  location.pathname === link.path
                    ? 'bg-primary-500 text-white'
                    : 'text-foreground-600 hover:bg-background-100'
                }`}
              >
                <i className={`${link.icon} text-lg`} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-3 right-3">
          <button
            onClick={async () => {
              await signOut();
              navigate('/');
            }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-red-500 hover:bg-red-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-logout-box-line text-lg" />
            <span>{t('logout')}</span>
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="bg-white border-b border-background-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
            >
              <i className="ri-menu-line text-foreground-600 text-lg" />
            </button>
            <h2 className="text-base font-semibold text-foreground-950 font-heading">{title}</h2>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {user?.role === 'SUPER_ADMIN' && companies.length > 1 && (
              <div className="relative">
                <select
                  value={companyId || ''}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="pl-8 pr-8 py-2 rounded-lg bg-background-50 border border-background-200 text-sm font-medium text-foreground-800 focus:outline-none focus:ring-2 focus:ring-primary-200 cursor-pointer appearance-none"
                >
                  <option value="" disabled>
                    Избери фирма
                  </option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
        <main className="flex-1 p-4 md:p-6">{children}</main>
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