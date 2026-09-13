import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import AppMenu from '@/pages/customer/components/AppMenu';

type TaxiRequest = Tables<'taxi_requests'>;

const STATUS_MAP: Record<string, { icon: string; color: string; bg: string }> = {
  pending: { icon: 'ri-search-line', color: 'text-primary-600', bg: 'bg-primary-100' },
  accepted: { icon: 'ri-user-star-line', color: 'text-accent-600', bg: 'bg-accent-100' },
  arrived: { icon: 'ri-car-line', color: 'text-accent-600', bg: 'bg-accent-100' },
  in_progress: { icon: 'ri-roadster-line', color: 'text-accent-600', bg: 'bg-accent-100' },
  completed: { icon: 'ri-check-double-line', color: 'text-primary-600', bg: 'bg-primary-100' },
  cancelled: { icon: 'ri-close-circle-line', color: 'text-red-500', bg: 'bg-red-50' },
};

export default function CustomerOrders() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  // Rating modal state
  const [ratingRequest, setRatingRequest] = useState<TaxiRequest | null>(null);
  const [ratingScore, setRatingScore] = useState(5);
  const [ratingFeedback, setRatingFeedback] = useState('');

  const customerId = user?.id;

  const ordersQuery = useQuery({
    queryKey: customerId ? queryKeys.customerOrders(customerId) : ['taxi_requests', 'customer', 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('customer_id', customerId as string)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!customerId,
  });

  const ratingsQuery = useQuery({
    queryKey: customerId ? queryKeys.customerRatings(customerId) : ['ratings', 'customer', 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ratings')
        .select('request_id')
        .eq('customer_id', customerId as string);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!customerId,
  });

  // Resolve vehicle_type_id → name so the vehicle badge actually renders.
  const vehicleTypesQuery = useQuery({
    queryKey: ['vehicle_types', user?.company_id ?? 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicle_types')
        .select('id, name')
        .eq('company_id', user?.company_id as string);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.company_id,
  });

  const vehicleTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const vt of vehicleTypesQuery.data ?? []) {
      map.set(vt.id, vt.name);
    }
    return map;
  }, [vehicleTypesQuery.data]);

  const ratedIds = useMemo(
    () => new Set((ratingsQuery.data ?? []).map((r) => r.request_id)),
    [ratingsQuery.data],
  );

  const ratingMutation = useMutation({
    mutationFn: async (input: { request: TaxiRequest; score: number; feedback: string }) => {
      const { error } = await supabase.from('ratings').insert({
        company_id: input.request.company_id,
        request_id: input.request.id,
        customer_id: customerId as string,
        driver_id: input.request.driver_id as string,
        score: input.score,
        feedback: input.feedback.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: customerId ? queryKeys.customerRatings(customerId) : ['ratings'],
      });
    },
  });

  const orders = ordersQuery.data ?? [];

  const activeOrders = orders.filter(
    (o) => !['completed', 'cancelled'].includes(o.status),
  );
  const completedOrders = orders.filter(
    (o) => ['completed', 'cancelled'].includes(o.status),
  );

  const displayedOrders = activeTab === 'active' ? activeOrders : completedOrders;

  const canRate = (order: TaxiRequest) =>
    order.status === 'completed' && !!order.driver_id && !ratedIds.has(order.id);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('bg-BG', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const openRating = (order: TaxiRequest) => {
    setRatingRequest(order);
    setRatingScore(5);
    setRatingFeedback('');
    ratingMutation.reset();
  };

  const submitRating = () => {
    if (!ratingRequest) return;
    ratingMutation.mutate(
      { request: ratingRequest, score: ratingScore, feedback: ratingFeedback },
      { onSuccess: () => setRatingRequest(null) },
    );
  };

  // Auto-open the rating modal when arriving from a freshly completed trip
  useEffect(() => {
    const rateParam = searchParams.get('rate');
    if (!rateParam) return;
    if (ordersQuery.isLoading || ratingsQuery.isLoading) return;
    const order = orders.find((o) => o.id === rateParam);
    if (order && canRate(order)) {
      openRating(order);
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, orders, ordersQuery.isLoading, ratingsQuery.isLoading]);

  if (ordersQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-foreground-500">{t('loading')}</span>
        </div>
      </div>
    );
  }

  if (ordersQuery.isError) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <i className="ri-error-warning-line text-2xl text-red-500" />
          </div>
          <p className="text-foreground-700 font-medium mb-1">{t('error_general')}</p>
          <p className="text-foreground-400 text-sm mb-4">
            {ordersQuery.error instanceof Error ? ordersQuery.error.message : ''}
          </p>
          <button
            onClick={() => ordersQuery.refetch()}
            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
          >
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-background-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/customer/home')}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer"
        >
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading flex-1">{t('nav_orders')}</h1>
        <AppMenu />
      </header>

      {/* Tabs */}
      <div className="sticky top-[52px] z-40 bg-background-50 px-4 pt-3 pb-2">
        <div className="flex bg-background-100 rounded-full p-1">
          <button
            onClick={() => setActiveTab('active')}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer
              ${activeTab === 'active'
                ? 'bg-white text-foreground-950 shadow-sm'
                : 'text-foreground-500 hover:text-foreground-700'
              }`}
          >
            {t('order_active_tab')}
            {activeOrders.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary-500 text-white text-[11px] font-bold">
                {activeOrders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`flex-1 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer
              ${activeTab === 'completed'
                ? 'bg-white text-foreground-950 shadow-sm'
                : 'text-foreground-500 hover:text-foreground-700'
              }`}
          >
            {t('order_history_tab')}
          </button>
        </div>
      </div>

      {/* Orders list */}
      <div className="px-4 pb-8">
        {displayedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 px-6">
            <div className="relative mb-5">
              <div className="w-20 h-20 rounded-3xl bg-primary-50 flex items-center justify-center">
                <i className="ri-taxi-line text-4xl text-primary-400" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center border-2 border-background-50">
                <i className="ri-inbox-line text-accent-600 text-sm" />
              </div>
            </div>
            <h3 className="text-base font-bold text-foreground-900 font-heading mb-1">
              {activeTab === 'active' ? t('no_active_orders') : t('no_completed_trips')}
            </h3>
            <p className="text-sm text-foreground-400 max-w-[250px] mb-6">
              {activeTab === 'active' ? t('order_from_home') : t('history_shown_here')}
            </p>
            {activeTab === 'active' && (
              <button
                onClick={() => navigate('/customer/home')}
                className="px-5 py-3 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 shadow-md shadow-primary-500/15"
              >
                <i className="ri-taxi-line" />
                {t('request_taxi')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2 pt-1">
            {displayedOrders.map((order) => {
              const statusInfo = STATUS_MAP[order.status] || STATUS_MAP.pending;
              return (
                <div
                  key={order.id}
                  className="bg-white rounded-2xl p-4 transition-all duration-200"
                >
                  {/* Status badge */}
                  <div className="flex items-center justify-between mb-3">
                    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusInfo.bg} ${statusInfo.color}`}>
                      <i className={`${statusInfo.icon} text-xs`} />
                      {t(`status_${order.status}`)}
                    </div>
                    <span className="text-xs text-foreground-400">
                      {formatDate(order.created_at)}
                    </span>
                  </div>

                  {/* Route */}
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-primary-500 flex-shrink-0" />
                      <div className="w-0.5 flex-1 min-h-[20px] bg-background-200" />
                      <div className="w-2.5 h-2.5 rounded bg-foreground-400 flex-shrink-0" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div>
                        <span className="text-xs text-foreground-400">От</span>
                        <p className="text-sm font-medium text-foreground-900 truncate">
                          {order.pickup_address}
                        </p>
                      </div>
                      <div>
                        <span className="text-xs text-foreground-400">До</span>
                        <p className="text-sm font-medium text-foreground-900 truncate">
                          {order.destination_address}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Footer info */}
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-background-100">
                    <div className="flex items-center gap-3 text-xs text-foreground-500 flex-wrap">
                      {order.estimated_distance_km != null && (
                        <span>{order.estimated_distance_km.toFixed(1)} {t('km')}</span>
                      )}
                      {order.estimated_duration_min != null && (
                        <span>{order.estimated_duration_min} {t('min')}</span>
                      )}
                      <span className="flex items-center gap-1">
                        <i className="ri-wallet-3-line text-foreground-400" />
                        {t(`payment_${order.payment_method}`)}
                      </span>
                      {order.vehicle_type_id && vehicleTypeMap.get(order.vehicle_type_id) && (
                        <span className="flex items-center gap-1 text-primary-600">
                          <i className="ri-car-line" />
                          {vehicleTypeMap.get(order.vehicle_type_id)}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-foreground-950 font-heading">
                      {(order.final_price || order.estimated_price)?.toFixed(2)} {t('lv')}
                    </span>
                  </div>

                  {/* Track active order */}
                  {['pending', 'accepted', 'arrived', 'in_progress'].includes(order.status) && (
                    <button
                      onClick={() => navigate('/customer/home')}
                      className="mt-3 w-full py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-2 shadow-md shadow-primary-500/15"
                    >
                      <i className="ri-radar-line" />
                      {t('track_trip')}
                    </button>
                  )}

                  {/* Rate button */}
                  {canRate(order) && (
                    <button
                      onClick={() => openRating(order)}
                      className="mt-3 w-full py-2.5 rounded-xl bg-primary-50 text-primary-700 text-sm font-semibold hover:bg-primary-100 transition-colors whitespace-nowrap cursor-pointer flex items-center justify-center gap-2"
                    >
                      <i className="ri-star-line" />
                      {t('rate_driver')}
                    </button>
                  )}
                  {order.status === 'completed' && ratedIds.has(order.id) && (
                    <div className="mt-3 w-full py-2.5 rounded-xl bg-background-50 text-foreground-400 text-sm font-medium flex items-center justify-center gap-2">
                      <i className="ri-check-double-line text-primary-600" />
                      {t('rated')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rating Modal */}
      {ratingRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setRatingRequest(null)} />
          <div className="relative bg-white rounded-2xl w-full max-w-sm p-6 text-center animate-in zoom-in-95 fade-in duration-200">
            <button
              onClick={() => setRatingRequest(null)}
              className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background-100 cursor-pointer"
            >
              <i className="ri-close-line text-foreground-500 text-lg" />
            </button>

            <div className="w-14 h-14 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-star-line text-2xl text-primary-600" />
            </div>
            <h3 className="text-lg font-bold text-foreground-950 font-heading mb-1">
              {t('rate_driver')}
            </h3>
            <p className="text-sm text-foreground-500 mb-4">{t('how_was_trip')}</p>

            {/* Stars */}
            <div className="flex justify-center gap-2 mb-5">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setRatingScore(s)}
                  className="cursor-pointer"
                >
                  <i
                    className={`${s <= ratingScore ? 'ri-star-fill text-primary-500' : 'ri-star-line text-foreground-300'} text-3xl transition-all duration-150`}
                  />
                </button>
              ))}
            </div>

            <textarea
              value={ratingFeedback}
              onChange={(e) => setRatingFeedback(e.target.value)}
              maxLength={500}
              placeholder={t('your_feedback')}
              rows={3}
              className="w-full px-3 py-2.5 bg-background-50 rounded-xl text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-accent-200 resize-none mb-1"
            />
            <p className="text-[11px] text-foreground-400 text-right mb-4">{ratingFeedback.length}/500</p>

            {ratingMutation.isError && (
              <p className="text-xs text-red-500 text-center mb-3">
                {ratingMutation.error instanceof Error
                  ? ratingMutation.error.message
                  : t('error_general')}
              </p>
            )}

            <button
              onClick={submitRating}
              disabled={ratingMutation.isPending}
              className="w-full py-3 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 shadow-md shadow-primary-500/15"
            >
              {ratingMutation.isPending ? t('loading') : t('submit_rating')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}