import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

interface TripAgg {
  id: string;
  driver_id: string | null;
  final_price: number | null;
  estimated_price: number;
  completed_at: string | null;
  created_at: string;
}

interface TopDriver {
  name: string;
  trips: number;
  revenue: number;
}

interface Period {
  label: string;
  value: number;
}

export default function AdminAnalytics() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [todayRevenue, setTodayRevenue] = useState(0);
  const [weekRevenue, setWeekRevenue] = useState(0);
  const [monthRevenue, setMonthRevenue] = useState(0);
  const [totalTrips, setTotalTrips] = useState(0);
  const [chartData, setChartData] = useState<Period[]>([]);
  const [topDrivers, setTopDrivers] = useState<TopDriver[]>([]);

  const fetchData = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('taxi_requests')
        .select('id, driver_id, final_price, estimated_price, completed_at, created_at')
        .eq('company_id', companyId);

      if (err) throw err;

      const trips = (data || []) as TripAgg[];
      const completed = trips.filter((r) => r.completed_at);
      setTotalTrips(completed.length);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86400000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const sumRevenue = (list: TripAgg[]) =>
        list.reduce((s, r) => s + parseFloat(String(r.final_price || r.estimated_price || 0)), 0);

      setTodayRevenue(sumRevenue(completed.filter((r) => new Date(r.completed_at!) >= todayStart)));
      setWeekRevenue(sumRevenue(completed.filter((r) => new Date(r.completed_at!) >= weekStart)));
      setMonthRevenue(sumRevenue(completed.filter((r) => new Date(r.completed_at!) >= monthStart)));

      // 7-day revenue chart
      const days: Period[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const next = new Date(d.getTime() + 86400000);
        const dayTrips = completed.filter((r) => {
          const c = new Date(r.completed_at!);
          return c >= d && c < next;
        });
        days.push({
          label: d.toLocaleDateString('bg-BG', { weekday: 'short' }),
          value: sumRevenue(dayTrips),
        });
      }
      setChartData(days);

      // Top drivers
      const driverIds = [...new Set(completed.map((r) => r.driver_id).filter(Boolean))] as string[];
      if (driverIds.length > 0) {
        const { data: drivers } = await supabase
          .from('drivers')
          .select('id, user_id')
          .in('id', driverIds);
        const userIds = (drivers || []).map((d) => d.user_id);
        const { data: users } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', userIds);
        const userMap = (users || []).reduce(
          (acc, u) => ({ ...acc, [u.id]: `${u.first_name || ''} ${u.last_name || ''}`.trim() }),
          {} as Record<string, string>
        );
        const driverUserIdMap = (drivers || []).reduce(
          (acc, d) => ({ ...acc, [d.id]: d.user_id }),
          {} as Record<string, string>
        );

        const byDriver = completed.reduce((acc, r) => {
          if (!r.driver_id) return acc;
          const key = r.driver_id;
          const entry = acc[key] || { trips: 0, revenue: 0 };
          entry.trips += 1;
          entry.revenue += parseFloat(String(r.final_price || r.estimated_price || 0));
          acc[key] = entry;
          return acc;
        }, {} as Record<string, { trips: number; revenue: number }>);

        const top = Object.entries(byDriver)
          .map(([driverId, stats]) => ({
            name: userMap[driverUserIdMap[driverId]] || 'Шофьор',
            trips: stats.trips,
            revenue: stats.revenue,
          }))
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        setTopDrivers(top);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Analytics error:', err);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const maxRevenue = Math.max(1, ...chartData.map((d) => d.value));

  const summaryCards = [
    { icon: 'ri-sun-line', label: 'Приходи днес', value: `${todayRevenue.toFixed(2)} €`, color: 'bg-primary-500' },
    { icon: 'ri-calendar-event-line', label: 'Приходи седмица', value: `${weekRevenue.toFixed(2)} €`, color: 'bg-primary-500' },
    { icon: 'ri-calendar-line', label: 'Приходи месец', value: `${monthRevenue.toFixed(2)} €`, color: 'bg-secondary-500' },
    { icon: 'ri-roadster-line', label: 'Общо пътувания', value: String(totalTrips), color: 'bg-primary-500' },
  ];

  return (
    <AdminLayout title={t('nav_analytics')}>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={fetchData} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            {summaryCards.map((card) => (
              <div key={card.label} className="bg-white rounded-xl p-5 border border-background-100">
                <div className="flex items-center gap-2 mb-3">
                  <div className={`w-9 h-9 rounded-lg ${card.color} flex items-center justify-center`}>
                    <i className={`${card.icon} text-white text-sm`} />
                  </div>
                </div>
                <p className="text-2xl font-bold text-foreground-950 font-heading">{card.value}</p>
                <p className="text-xs text-foreground-500 mt-0.5">{card.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue chart */}
            <div className="bg-white rounded-xl p-5 md:p-6 border border-background-100">
              <h3 className="font-semibold text-foreground-950 mb-4">Приходи (7 дни)</h3>
              <div className="flex items-end gap-2 h-48">
                {chartData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-xs text-foreground-500">{d.value.toFixed(0)}</span>
                    <div
                      className="w-full max-w-[44px] rounded-t-md bg-primary-500 transition-all duration-500"
                      style={{ height: `${(d.value / maxRevenue) * 140}px` }}
                    />
                    <span className="text-xs text-foreground-400 capitalize">{d.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top drivers */}
            <div className="bg-white rounded-xl p-5 md:p-6 border border-background-100">
              <h3 className="font-semibold text-foreground-950 mb-4">Топ шофьори</h3>
              {topDrivers.length === 0 ? (
                <div className="text-center py-12">
                  <i className="ri-trophy-line text-3xl text-foreground-300" />
                  <p className="text-sm text-foreground-400 mt-2">Няма данни</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {topDrivers.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 py-2.5">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        i === 0 ? 'bg-primary-500 text-white' : 'bg-background-100 text-foreground-600'
                      }`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground-900 truncate">{d.name}</p>
                        <p className="text-xs text-foreground-400">{d.trips} пътувания</p>
                      </div>
                      <span className="font-semibold text-foreground-950 font-heading text-sm">
                        {d.revenue.toFixed(2)} €
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AdminLayout>
  );
}