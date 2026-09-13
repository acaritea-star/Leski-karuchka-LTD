import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';

type TaxiRequest = Tables<'taxi_requests'>;

interface EarningsData {
  today: number;
  week: number;
  month: number;
  totalTrips: number;
  avgPerTrip: number;
  recentTrips: TaxiRequest[];
}

export default function DriverEarnings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const driverQuery = useQuery({
    queryKey: user?.id ? queryKeys.driverRecord(user.id) : ['drivers', 'me', 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });
  const driverId = driverQuery.data?.id ?? null;

  const earningsQuery = useQuery({
    queryKey: driverId ? queryKeys.driverEarnings(driverId) : ['taxi_requests', 'driver', 'none', 'earnings'],
    queryFn: async (): Promise<EarningsData> => {
      const { data: trips, error } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('driver_id', driverId!)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false });
      if (error) throw error;

      const allTrips = trips ?? [];

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart.getTime() - todayStart.getDay() * 86400000);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      let todaySum = 0;
      let weekSum = 0;
      let monthSum = 0;
      let totalSum = 0;

      for (const trip of allTrips) {
        const price = Number(trip.final_price ?? trip.estimated_price ?? 0);
        const completedDate = new Date(trip.completed_at ?? 0);
        totalSum += price;
        if (completedDate >= todayStart) todaySum += price;
        if (completedDate >= weekStart) weekSum += price;
        if (completedDate >= monthStart) monthSum += price;
      }

      return {
        today: todaySum,
        week: weekSum,
        month: monthSum,
        totalTrips: allTrips.length,
        avgPerTrip: allTrips.length > 0 ? totalSum / allTrips.length : 0,
        recentTrips: allTrips.slice(0, 10),
      };
    },
    enabled: !!driverId,
  });

  const earnings = earningsQuery.data ?? {
    today: 0,
    week: 0,
    month: 0,
    totalTrips: 0,
    avgPerTrip: 0,
    recentTrips: [],
  };
  const loading = driverQuery.isLoading || earningsQuery.isLoading;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('bg-BG', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-background-50">
      <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
        <button onClick={() => navigate('/driver/home')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer">
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_earnings')}</h1>
      </header>

      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-white rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-sun-line text-primary-600 text-sm" />
                  </div>
                  <span className="text-xs text-foreground-500">{t('today')}</span>
                </div>
                <p className="text-2xl font-bold text-foreground-950 font-heading">
                  {earnings.today.toFixed(2)} <span className="text-sm font-normal text-foreground-500">{t('lv')}</span>
                </p>
              </div>

              <div className="bg-white rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-calendar-event-line text-primary-600 text-sm" />
                  </div>
                  <span className="text-xs text-foreground-500">{t('this_week')}</span>
                </div>
                <p className="text-2xl font-bold text-foreground-950 font-heading">
                  {earnings.week.toFixed(2)} <span className="text-sm font-normal text-foreground-500">{t('lv')}</span>
                </p>
              </div>

              <div className="bg-white rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-calendar-line text-primary-600 text-sm" />
                  </div>
                  <span className="text-xs text-foreground-500">{t('this_month')}</span>
                </div>
                <p className="text-2xl font-bold text-foreground-950 font-heading">
                  {earnings.month.toFixed(2)} <span className="text-sm font-normal text-foreground-500">{t('lv')}</span>
                </p>
              </div>

              <div className="bg-white rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center">
                    <i className="ri-bar-chart-2-line text-primary-600 text-sm" />
                  </div>
                  <span className="text-xs text-foreground-500">{t('avg_trip_value')}</span>
                </div>
                <p className="text-2xl font-bold text-foreground-950 font-heading">
                  {earnings.avgPerTrip.toFixed(2)} <span className="text-sm font-normal text-foreground-500">{t('lv')}</span>
                </p>
                <p className="text-xs text-foreground-400 mt-1">{earnings.totalTrips} {t('total_trips_all_time').toLowerCase()}</p>
              </div>
            </div>

            {/* Recent Trips */}
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-foreground-900 mb-3">{t('recent_trips')}</h3>
              {earnings.recentTrips.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-12 bg-white rounded-2xl">
                  <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
                    <i className="ri-money-dollar-circle-line text-3xl text-primary-400" />
                  </div>
                  <p className="text-sm font-semibold text-foreground-700 mb-1">{t('no_earnings')}</p>
                  <p className="text-xs text-foreground-400 max-w-[240px]">{t('earnings_empty_hint')}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {earnings.recentTrips.map((trip) => (
                    <div key={trip.id} className="bg-white rounded-xl p-3.5 flex items-center justify-between">
                      <div className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-medium text-foreground-900 truncate">{trip.pickup_address}</p>
                        <p className="text-xs text-foreground-400 truncate mt-0.5">{trip.destination_address}</p>
                        <p className="text-[11px] text-foreground-400 mt-1">{formatDate(trip.completed_at)}</p>
                      </div>
                      <span className="text-base font-bold text-foreground-950 font-heading flex-shrink-0">
                        {parseFloat(String(trip.final_price || trip.estimated_price || 0)).toFixed(2)} {t('lv')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}