import { useTranslation } from 'react-i18next';
import { loadCompanyDashboard } from '@/lib/serverSummaries';
import { useSofiaDay } from '@/hooks/useSofiaDay';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import OperationalHealth from '@/components/feature/OperationalHealth';
import { useFleetClock } from '@/hooks/useFleetClock';
import { GPS_STALE_MS } from '@/lib/driverLocation';
import { Link } from 'react-router-dom';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { companyId, companyName, loading: companyLoading } = useAdminCompany();
  const day = useSofiaDay();
  const now = useFleetClock();

  const dashboardQuery = useQuery({
    queryKey: companyId ? queryKeys.adminDashboard(companyId, day) : ['dashboard', 'none'],
    queryFn: ({ signal }) => loadCompanyDashboard(companyId!, signal),
    enabled: !!companyId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const stats = dashboardQuery.data?.stats ?? {
    totalDrivers: 0,
    onlineDrivers: 0,
    activeOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    totalRevenue: 0,
  };
  const chartData = dashboardQuery.data?.chartData ?? [];
  const error = dashboardQuery.error instanceof Error ? dashboardQuery.error.message : '';
  const loading = companyLoading || dashboardQuery.isLoading;
  const onlineConfirmed = dashboardQuery.data && !dashboardQuery.isError && now - dashboardQuery.dataUpdatedAt < GPS_STALE_MS;

  const maxOrders = Math.max(1, ...chartData.map((d) => d.orders));
  const maxRevenue = Math.max(1, ...chartData.map((d) => d.revenue));

  const statCards = [
    { icon: 'ri-steering-line', label: t('online_drivers'), value: onlineConfirmed ? String(stats.onlineDrivers) : '—', color: 'bg-primary-500' },
    { icon: 'ri-user-star-line', label: 'Общо шофьори', value: dashboardQuery.data ? String(stats.totalDrivers) : '—', color: 'bg-primary-500' },
    { icon: 'ri-timer-line', label: t('active_orders'), value: dashboardQuery.data ? String(stats.activeOrders) : '—', color: 'bg-secondary-500' },
    { icon: 'ri-check-double-line', label: t('completed_orders'), value: dashboardQuery.data ? String(stats.completedOrders) : '—', color: 'bg-primary-500' },
    { icon: 'ri-close-circle-line', label: t('cancelled_orders'), value: dashboardQuery.data ? String(stats.cancelledOrders) : '—', color: 'bg-primary-500' },
    {
      icon: 'ri-money-dollar-circle-line',
      label: 'Стойност на завършените курсове',
      value: dashboardQuery.data ? `${stats.totalRevenue.toFixed(2)} €` : '—',
      color: 'bg-secondary-500',
    },
  ];

  return (
    <AdminLayout title={t('nav_dashboard')}>
      <section className="mb-5 rounded-2xl border border-background-200 bg-white p-5 md:p-6">
        <p className="text-xs font-semibold text-primary-700 mb-1">ТВОЯТА ФИРМА</p>
        <h3 className="text-2xl font-heading font-bold text-foreground-950 break-words">{companyName || 'Фирмен преглед'}</h3>
        <p className="text-sm text-foreground-500 mt-2">{companyId ? 'Екипът, текущите заявки и отчетността — на едно място.' : 'Избери фирма от селектора, за да отвориш нейния преглед.'}</p>
        {companyId && <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mt-5" aria-label="Бързи действия">
          {[
            { path: '/admin/analytics', label: 'Отчети и каса', detail: 'Плащания, разходи и сверяване', icon: 'ri-bar-chart-line' },
            { path: '/admin/drivers', label: 'Шофьори', detail: 'Покани, документи и одобрение', icon: 'ri-steering-line' },
            { path: '/admin/vehicles', label: 'Автомобили', detail: 'Назначения и валидност', icon: 'ri-car-line' },
          ].map(action => <Link key={action.path} to={action.path} aria-label={action.label} className="min-w-0 flex items-center gap-2 sm:gap-3 text-left rounded-xl border border-background-200 p-3 hover:border-primary-300 hover:bg-primary-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
            <span className="w-10 h-10 rounded-xl bg-primary-50 text-primary-700 flex items-center justify-center shrink-0"><i className={`${action.icon} text-xl`} aria-hidden="true" /></span>
            <div className="min-w-0 break-words"><p className="font-semibold text-xs sm:text-sm text-foreground-950">{action.label}</p><p className="hidden lg:block text-xs text-foreground-500 mt-0.5">{action.detail}</p></div>
            <i className="hidden lg:block ri-arrow-right-s-line ml-auto text-foreground-400" aria-hidden="true" />
          </Link>)}
        </div>}
      </section>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => dashboardQuery.refetch()} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-foreground-500">{t('loading')}</span>
          </div>
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4 mb-3">
            {[statCards[5], statCards[0], statCards[2]].map((stat, index) => (
              <div key={stat.label} className={`bg-white rounded-2xl p-5 border border-background-200 ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}>
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-9 h-9 rounded-lg ${stat.color} flex items-center justify-center`}>
                    <i className={`${stat.icon} text-white text-sm`} />
                  </div>
                </div>
                <p className="text-2xl md:text-3xl font-bold text-foreground-950 font-heading tabular-nums">{stat.value}</p>
                <p className="text-xs text-foreground-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-foreground-500 mb-5">Стойността е за всички завършени курсове. Реално отчетените плащания и касовото сверяване са в „Отчети и каса“.</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mb-5 px-1" aria-label="Обобщение на курсовете">
            {[statCards[1], statCards[3], statCards[4]].map(stat => <p key={stat.label} className="text-sm text-foreground-500">{stat.label}: <strong className="text-foreground-950 tabular-nums">{stat.value}</strong></p>)}
          </div>
          {companyId && <OperationalHealth companyId={companyId} />}

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl p-5 md:p-6 border border-background-100">
              <h3 className="font-semibold text-foreground-950 mb-4">Поръчки (7 дни)</h3>
              <div className="flex items-end gap-2 h-44">
                {chartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs text-foreground-500">{d.orders}</span>
                    <div
                      className="w-full max-w-[40px] rounded-t-md bg-primary-500 transition-all duration-500"
                      style={{ height: `${(d.orders / maxOrders) * 130}px` }}
                    />
                    <span className="text-xs text-foreground-400 capitalize">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl p-5 md:p-6 border border-background-100">
              <h3 className="font-semibold text-foreground-950 mb-4">Стойност на завършените курсове (7 дни)</h3>
              <div className="flex items-end gap-2 h-44">
                {chartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs text-foreground-500">{d.revenue.toFixed(2)}</span>
                    <div
                      className="w-full max-w-[40px] rounded-t-md bg-primary-500 transition-all duration-500"
                      style={{ height: `${(d.revenue / maxRevenue) * 130}px` }}
                    />
                    <span className="text-xs text-foreground-400 capitalize">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}
