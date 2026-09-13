import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

interface DashboardStats {
  totalDrivers: number;
  onlineDrivers: number;
  activeOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalRevenue: number;
}

interface DayPoint {
  label: string;
  orders: number;
  revenue: number;
}

const ACTIVE_STATUSES = ['pending', 'accepted', 'arrived', 'in_progress'];

export default function AdminDashboard() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const dashboardQuery = useQuery({
    queryKey: companyId ? queryKeys.adminDashboard(companyId) : ['dashboard', 'none'],
    queryFn: async (): Promise<{ stats: DashboardStats; chartData: DayPoint[] }> => {
      const { data: drivers, error: driversErr } = await supabase
        .from('drivers')
        .select('is_online')
        .eq('company_id', companyId!);
      if (driversErr) throw driversErr;

      const { data: requests, error: reqErr } = await supabase
        .from('taxi_requests')
        .select('status, final_price, estimated_price, completed_at')
        .eq('company_id', companyId!);
      if (reqErr) throw reqErr;

      const allRequests = requests ?? [];
      const stats: DashboardStats = {
        totalDrivers: (drivers ?? []).length,
        onlineDrivers: (drivers ?? []).filter((d) => d.is_online).length,
        activeOrders: allRequests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length,
        completedOrders: allRequests.filter((r) => r.status === 'completed').length,
        cancelledOrders: allRequests.filter((r) => r.status === 'cancelled').length,
        totalRevenue: allRequests
          .filter((r) => r.status === 'completed')
          .reduce((sum, r) => sum + Number(r.final_price ?? r.estimated_price ?? 0), 0),
      };

      const days: DayPoint[] = [];
      const now = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const next = new Date(d.getTime() + 86400000);
        const dayRequests = allRequests.filter((r) => {
          if (!r.completed_at) return false;
          const c = new Date(r.completed_at);
          return c >= d && c < next;
        });
        days.push({
          label: d.toLocaleDateString('bg-BG', { weekday: 'short' }),
          orders: dayRequests.length,
          revenue: dayRequests.reduce((sum, r) => sum + Number(r.final_price ?? r.estimated_price ?? 0), 0),
        });
      }

      return { stats, chartData: days };
    },
    enabled: !!companyId,
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
  const loading = dashboardQuery.isLoading;

  const maxOrders = Math.max(1, ...chartData.map((d) => d.orders));
  const maxRevenue = Math.max(1, ...chartData.map((d) => d.revenue));

  const statCards = [
    { icon: 'ri-steering-line', label: t('online_drivers'), value: String(stats.onlineDrivers), color: 'bg-primary-500' },
    { icon: 'ri-user-star-line', label: 'Общо шофьори', value: String(stats.totalDrivers), color: 'bg-primary-500' },
    { icon: 'ri-timer-line', label: t('active_orders'), value: String(stats.activeOrders), color: 'bg-secondary-500' },
    { icon: 'ri-check-double-line', label: t('completed_orders'), value: String(stats.completedOrders), color: 'bg-primary-500' },
    { icon: 'ri-close-circle-line', label: t('cancelled_orders'), value: String(stats.cancelledOrders), color: 'bg-primary-500' },
    {
      icon: 'ri-money-dollar-circle-line',
      label: t('total_revenue'),
      value: `${stats.totalRevenue.toFixed(2)} €`,
      color: 'bg-secondary-500',
    },
  ];

  return (
    <AdminLayout title={t('nav_dashboard')}>
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4 mb-6">
            {statCards.map((stat) => (
              <div key={stat.label} className="bg-white rounded-xl p-4 border border-background-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-9 h-9 rounded-lg ${stat.color} flex items-center justify-center`}>
                    <i className={`${stat.icon} text-white text-sm`} />
                  </div>
                </div>
                <p className="text-xl md:text-2xl font-bold text-foreground-950 font-heading">{stat.value}</p>
                <p className="text-xs text-foreground-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

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
              <h3 className="font-semibold text-foreground-950 mb-4">Приходи (7 дни)</h3>
              <div className="flex items-end gap-2 h-44">
                {chartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs text-foreground-500">{d.revenue.toFixed(0)}</span>
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