import { driverRecordOptions } from '@/lib/driverRecord';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { withRequestTimeout } from '@/lib/requestTimeout';

const STATUS_LABELS: Record<string, string> = {
  completed: 'status_completed',
  cancelled: 'status_cancelled',
};

export default function DriverHistory() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | 'completed' | 'cancelled'>('all');

  const driverQuery = useQuery(driverRecordOptions(user?.id));
  const driverId = driverQuery.data?.id ?? null;

  const tripsQuery = useQuery({
    queryKey: driverId ? queryKeys.driverHistory(driverId, filter) : ['taxi_requests', 'driver', 'none', 'history', filter],
    queryFn: async ({ signal }) => {
      let query = supabase
        .from('taxi_requests')
        .select('id,status,completed_at,cancelled_at,pickup_address,destination_address,estimated_distance_km,estimated_duration_min,final_price,estimated_price')
        .eq('driver_id', driverId!);
      if (filter === 'completed') {
        query = query.eq('status', 'completed');
      } else if (filter === 'cancelled') {
        query = query.eq('status', 'cancelled');
      } else {
        query = query.in('status', ['completed', 'cancelled']);
      }
      const { data, error } = await withRequestTimeout(abort => query.order('created_at', { ascending: false })
        .order('id', { ascending: false }).limit(50).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!driverId,
  });

  const trips = tripsQuery.data ?? [];
  const loading = driverQuery.isLoading || tripsQuery.isLoading;
  const failed = driverQuery.isError || tripsQuery.isError;

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
        <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_history')}</h1>
      </header>

      <div className="p-4">
        {/* Filter tabs */}
        <div className="flex gap-2 mb-4">
          {(['all', 'completed', 'cancelled'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer
                ${filter === f
                  ? 'bg-primary-500 text-white'
                  : 'bg-white text-foreground-500 hover:bg-background-100'
                }`}
            >
              {f === 'all' ? t('filter_all') : f === 'completed' ? t('completed') : t('cancelled')}
            </button>
          ))}
        </div>

        {failed ? (
          <div role="alert" className="py-12 text-center">
            <p className="text-sm text-red-600 mb-3">Историята не се зареди. Проверете връзката и опитайте отново.</p>
            <button onClick={() => driverQuery.isError ? driverQuery.refetch() : tripsQuery.refetch()}
              className="px-4 py-2 rounded-full bg-white text-sm text-foreground-600 cursor-pointer">{t('retry')}</button>
          </div>
        ) : loading ? (
          <div className="flex justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : trips.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20">
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-3xl bg-primary-50 flex items-center justify-center">
                <i className="ri-history-line text-4xl text-primary-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center border-2 border-background-50">
                <i className="ri-road-map-line text-accent-600 text-sm" />
              </div>
            </div>
            <h3 className="text-base font-bold text-foreground-900 font-heading mb-1">{t('no_history')}</h3>
            <p className="text-sm text-foreground-400 max-w-[250px]">{t('history_empty_hint')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {trips.map((trip) => (
              <div key={trip.id} className="bg-white rounded-2xl p-4">
                {/* Status badge */}
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full
                    ${trip.status === 'completed' ? 'bg-primary-100 text-primary-700' : 'bg-red-50 text-red-600'}`}>
                    {t(STATUS_LABELS[trip.status] || trip.status)}
                  </span>
                  <span className="text-xs text-foreground-400">
                    {formatDate(trip.completed_at || trip.cancelled_at)}
                  </span>
                </div>

                {/* Route */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                    <div className={`w-2.5 h-2.5 rounded-full ${trip.status === 'completed' ? 'bg-primary-500' : 'bg-red-300'}`} />
                    <div className="w-0.5 h-6 bg-background-200 my-0.5" />
                    <div className="w-2.5 h-2.5 rounded bg-foreground-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-900 truncate">{trip.pickup_address}</p>
                    <p className="text-xs text-foreground-500 mt-3 truncate">{trip.destination_address}</p>
                  </div>
                </div>

                {/* Bottom row */}
                <div className="flex items-center justify-between pt-2 border-t border-background-100">
                  <div className="flex items-center gap-3 text-xs text-foreground-500">
                    {trip.estimated_distance_km != null && <span>{trip.estimated_distance_km.toFixed(1)} {t('km')}</span>}
                    <span>{trip.estimated_duration_min} {t('min')}</span>
                  </div>
                  <span className="text-base font-bold text-foreground-950 font-heading">
                    {trip.status === 'cancelled' ? '—' : `${(trip.final_price ?? trip.estimated_price ?? 0).toFixed(2)} ${t('lv')}`}
                  </span>
                </div>
              </div>
            ))}
            {trips.length === 50 && <p className="text-xs text-center text-foreground-500">Показани са последните 50 курса за избрания филтър. Пълните суми са в отчета.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
