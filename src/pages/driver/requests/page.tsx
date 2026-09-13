import { setDriverOnline } from '@/lib/driverLocation';
import { useDriverGps } from '@/components/feature/DriverGpsProvider';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { sendPushToUser } from '@/lib/push';
import type { Tables } from '@/lib/database.types';
import { calculateDistance, estimateDuration } from '@/lib/geo';
import DriverRouteMap, { type NavInfo } from '@/pages/driver/components/DriverRouteMap';
import { useDriverDeclines } from '@/hooks/useDriverDeclines';

// ── Notification helper ──
async function notifyCustomer(
  customerId: string,
  companyId: string,
  title: string,
  message: string,
  requestId: string,
  status: string,
) {
  try {
    await supabase.from('notifications').insert({
      user_id: customerId,
      company_id: companyId,
      type: 'trip_status',
      title,
      message,
      data: { request_id: requestId, status },
    });
  } catch {
    /* silently ignore notification failures */
  }
}

// ── Push helper for customer ──
async function pushCustomer(
  customerId: string,
  title: string,
  body: string,
  type: string,
  requireInteraction = false,
) {
  await sendPushToUser(customerId, title, body, {
    tag: `trip-${type}`,
    data: { type: 'trip_status', role: 'CUSTOMER' },
    requireInteraction,
    renotify: true,
    vibrate: type === 'new_request' ? [300, 100, 300, 100, 300] : [150, 50, 150],
  });
}

type TaxiRequest = Tables<'taxi_requests'>;
type DriverRecord = Tables<'drivers'>;

function routeStats(r: Pick<TaxiRequest, 'pickup_latitude' | 'pickup_longitude' | 'destination_latitude' | 'destination_longitude'>): { distance: number; duration: number } {
  if (r.destination_latitude == null || r.destination_longitude == null) {
    return { distance: 0, duration: 0 };
  }
  const distance = calculateDistance(r.pickup_latitude, r.pickup_longitude, r.destination_latitude, r.destination_longitude);
  return { distance, duration: estimateDuration(distance) };
}

export default function DriverRequests() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playDriverSound, unlockAudio } = useNotificationSound();
  const { register: registerPush } = usePushNotifications();

  const [toggleError, setGpsError] = useState('');
  const gps = useDriverGps();
  const gpsError = toggleError || gps.error;
  const [error, setError] = useState('');
  const [driverNavInfo, setDriverNavInfo] = useState<NavInfo | null>(null);

  // Unlock audio on first user interaction (required by browsers)
  useEffect(() => {
    const handler = () => {
      unlockAudio();
    };
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [unlockAudio]);

  // Register push notifications when driver comes online
  useEffect(() => {
    if (user?.id && user?.role === 'DRIVER') {
      registerPush(user.id);
    }
  }, [user?.id, user?.role, registerPush]);

  // ── Driver record ──
  const driverQuery = useQuery({
    queryKey: user?.id ? queryKeys.driverRecord(user.id) : ['drivers', 'me', 'none'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });
  const driver = driverQuery.data ?? null;
  const isOnline = driver?.is_online ?? false;
  const { declinedIds, decline, declineError, isDeclining } = useDriverDeclines(driver?.id);

  useEffect(() => {
    if (declineError) {
      setError(declineError instanceof Error ? declineError.message : t('request_missed'));
    }
  }, [declineError, t]);

  // ── Active request ──
  const activeRequestQuery = useQuery({
    queryKey: driver?.id ? queryKeys.driverActiveRequest(driver.id) : ['taxi_requests', 'driver', 'none', 'active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('driver_id', driver!.id)
        .in('status', ['accepted', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!driver?.id,
  });
  const activeRequest = activeRequestQuery.data ?? null;

  // Reset nav info when active request changes (pickup → destination switch)
  useEffect(() => {
    setDriverNavInfo(null);
  }, [activeRequest?.id, activeRequest?.status]);

  // ── Incoming requests ──
  const incomingQuery = useQuery({
    queryKey: user?.company_id ? queryKeys.driverIncomingRequests(user.company_id) : ['taxi_requests', 'company', 'none', 'incoming'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('company_id', user!.company_id!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.company_id && isOnline && !!driver?.id,
    refetchInterval: isOnline ? 8000 : false,
  });
  const incomingRequests = (incomingQuery.data ?? []).filter((r) => !declinedIds.has(r.id));

  // ── Toggle online / offline ──
  const toggleMutation = useMutation({
    mutationFn: async () => {
      if (!driver) throw new Error('No driver record');
      const goingOnline = !driver.is_online;

      await setDriverOnline(driver, goingOnline);
      return goingOnline;
    },
    onSuccess: () => {
      setGpsError('');
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverRecord(user.id) });
      }
    },
    onError: (err) => {
      setGpsError(err instanceof Error ? err.message : t('gps_error'));
    },
  });

  // ── Accept request ──
  const acceptMutation = useMutation({
    mutationFn: async (requestId: string) => {
      if (!driver) throw new Error('No driver record');
      const { data, error: updateError } = await supabase
        .from('taxi_requests')
        .update({ driver_id: driver.id, status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('*')
        .single();
      if (updateError) throw updateError;
      return data;
    },
    onSuccess: async (data) => {
      setError('');
      // Push to customer that driver accepted
      if (data.customer_id) {
        await pushCustomer(
          data.customer_id,
          t('push_driver_accepted_title'),
          t('push_driver_accepted_body', { addr: data.pickup_address }),
          'accepted',
          true,
        );
      }
      if (driver?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      }
      if (user?.company_id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.company_id) });
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('request_missed'));
      if (user?.company_id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.company_id) });
      }
    },
  });

  // ── Arrived action ──
  const arrivedMutation = useMutation({
    mutationFn: async (request: TaxiRequest) => {
      const { error } = await supabase
        .from('taxi_requests')
        .update({ status: 'arrived', arrived_at: new Date().toISOString() })
        .eq('id', request.id).eq('status', request.status).select('id').single();
      if (error) throw error;
      return { ...request, status: 'arrived' as const };
    },
    onSuccess: async (updated) => {
      setError('');
      // Push + in-app notification to customer
      if (updated.customer_id && updated.company_id) {
        notifyCustomer(
          updated.customer_id,
          updated.company_id,
          t('push_driver_arrived_title'),
          t('push_driver_arrived_body', { addr: updated.pickup_address }),
          updated.id,
          updated.status,
        );
        await pushCustomer(
          updated.customer_id,
          t('push_driver_arrived_title'),
          t('push_driver_arrived_body', { addr: updated.pickup_address }),
          'arrived',
          true,
        );
      }
      if (driver?.id) {
        queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), updated);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('trip_arrived_error'));
    },
  });

  // ── Start trip action ──
  const startMutation = useMutation({
    mutationFn: async (request: TaxiRequest) => {
      const { error } = await supabase
        .from('taxi_requests')
        .update({ status: 'in_progress', started_at: new Date().toISOString() })
        .eq('id', request.id).eq('status', request.status).select('id').single();
      if (error) throw error;
      return { ...request, status: 'in_progress' as const };
    },
    onSuccess: async (updated) => {
      setError('');
      if (updated.customer_id && updated.company_id) {
        notifyCustomer(
          updated.customer_id,
          updated.company_id,
          t('push_trip_started_title'),
          t('push_trip_started_body'),
          updated.id,
          updated.status,
        );
        await pushCustomer(
          updated.customer_id,
          t('push_trip_started_title'),
          t('push_trip_started_body'),
          'in_progress',
          false,
        );
      }
      if (driver?.id) {
        queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), updated);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('trip_start_error'));
    },
  });

  // ── End trip action ──
  const endMutation = useMutation({
    mutationFn: async (request: TaxiRequest) => {
      const { error } = await supabase
        .from('taxi_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString(), final_price: request.estimated_price })
        .eq('id', request.id).eq('status', request.status).select('id').single();
      if (error) throw error;
      return { ...request, status: 'completed' as const };
    },
    onSuccess: async (updated) => {
      setError('');
      const priceLabel = `${parseFloat(String(updated.estimated_price)).toFixed(2)} ${t('lv')}`;
      if (updated.customer_id && updated.company_id) {
        notifyCustomer(
          updated.customer_id,
          updated.company_id,
          t('push_trip_completed_title'),
          t('push_trip_completed_body', { price: priceLabel }),
          updated.id,
          updated.status,
        );
        await pushCustomer(
          updated.customer_id,
          t('push_trip_completed_title'),
          t('push_trip_completed_body', { price: priceLabel }),
          'completed',
          true,
        );
      }
      if (driver?.id) {
        queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), null);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('trip_end_error'));
    },
  });

  // ── Realtime: taxi_requests ──
  useEffect(() => {
    if (!user?.company_id || !driver?.id) return;
    const companyId = user.company_id;

    const channel = supabase
      .channel(`driver-requests-panel-${driver.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'taxi_requests', filter: 'status=eq.pending' },
        (payload) => {
          const newRow = payload.new as TaxiRequest;
          if (newRow.company_id === companyId && newRow.status === 'pending' && isOnline) {
            playDriverSound();
            queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(companyId) });
          }
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'taxi_requests', filter: `driver_id=eq.${driver.id}` },
        (payload) => {
          const newRow = payload.new as TaxiRequest;
          if (['accepted', 'arrived', 'in_progress'].includes(newRow.status)) {
            queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), newRow);
            queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(companyId) });
          } else if (['completed', 'cancelled'].includes(newRow.status)) {
            queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), null);
          }
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'taxi_requests' }, (payload) => {
        const oldRow = payload.old as Partial<TaxiRequest> | undefined;
        const newRow = payload.new as TaxiRequest;
        if (oldRow?.status === 'pending' && newRow.status !== 'pending' && newRow.company_id === companyId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(companyId) });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.company_id, driver?.id, isOnline, queryClient, playDriverSound]);

  // ── Realtime: own driver row (sync is_online across tabs) ──
  useEffect(() => {
    if (!driver?.id) return;
    const channel = supabase
      .channel(`driver-self-${driver.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driver.id}` },
        () => {
          if (user?.id) {
            queryClient.invalidateQueries({ queryKey: queryKeys.driverRecord(user.id) });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, user?.id, queryClient]);

  const activeRoute = activeRequest ? routeStats(activeRequest) : null;

  // Navigation target: heading to pickup while accepted, to destination afterwards
  const navTarget = activeRequest
    ? activeRequest.status === 'accepted'
      ? { lat: activeRequest.pickup_latitude, lng: activeRequest.pickup_longitude }
      : { lat: activeRequest.destination_latitude, lng: activeRequest.destination_longitude }
    : null;

  // Helper for the distance label shown in the top-right of the active card
  function activeDistanceLabel(): string {
    if (!activeRequest) return '0.0';
    if (activeRequest.status === 'arrived') return '0.0';
    if (activeRequest.status === 'accepted' || activeRequest.status === 'in_progress') {
      if (driverNavInfo) {
        return `${driverNavInfo.distance_km.toFixed(1)} ${t('km')}`;
      }
      return `${t('calculating')}...`;
    }
    return `${activeRoute ? activeRoute.distance.toFixed(1) : '0.0'} ${t('km')}`;
  }

  // Helper for the duration label shown in the top-right of the active card
  function activeDurationLabel(): string {
    if (!activeRequest) return '0';
    if (activeRequest.status === 'arrived') return '0';
    if (activeRequest.status === 'accepted' || activeRequest.status === 'in_progress') {
      if (driverNavInfo) {
        return `${driverNavInfo.duration_min} ${t('min')}`;
      }
      return '—';
    }
    return `${activeRoute ? activeRoute.duration : '0'} ${t('min')}`;
  }

  if (driverQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-foreground-500">{t('loading')}</span>
        </div>
      </div>
    );
  }

  const toggling = toggleMutation.isPending;

  return (
    <div className="min-h-screen bg-background-50">
      {/* ── Header ── */}
      <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50 border-b border-background-100">
        <button
          onClick={() => navigate('/driver/home')}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-background-100 transition-colors cursor-pointer"
        >
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-base font-bold text-foreground-950 font-heading">{t('nav_requests')}</h1>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-foreground-400 bg-background-100 px-3 py-1.5 rounded-full">
            <i className="ri-wifi-off-line text-xs" />
            {t('you_are_offline')}
          </span>
        )}
        {isOnline && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-accent-600 bg-accent-50 px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />
            {t('you_are_online')}
          </span>
        )}
      </header>

      <div className="p-4 max-w-lg mx-auto">
        {/* ── Error ── */}
        {error && (
          <div className="mb-3 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <i className="ri-error-warning-line" />
            {error}
            <button onClick={() => setError('')} className="ml-auto w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-100 cursor-pointer">
              <i className="ri-close-line text-red-400 text-xs" />
            </button>
          </div>
        )}

        {/* ── Offline Card ── */}
        {!isOnline && !activeRequest && (
          <div className="bg-white rounded-2xl border border-background-100 p-6 text-center mb-4">
            <div className="w-16 h-16 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-wifi-off-line text-3xl text-foreground-300" />
            </div>
            <p className="text-foreground-600 font-medium text-sm mb-1">{t('go_online_to_receive')}</p>
            <p className="text-xs text-foreground-400 mb-5">{t('go_online_hint')}</p>
            <button
              onClick={() => toggleMutation.mutate()}
              disabled={toggling}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all duration-300 whitespace-nowrap cursor-pointer
                ${toggling ? 'opacity-70' : 'active:scale-[0.98]'}
                bg-primary-500 text-white hover:bg-primary-600 flex items-center justify-center gap-2`}
            >
              {toggling ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('toggle_on')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                  {t('go_online_btn')}
                </span>
              )}
            </button>
            {gpsError && (
              <p className="text-xs text-red-500 mt-3 flex items-center justify-center gap-1">
                <i className="ri-error-warning-line" /> {gpsError}
              </p>
            )}
          </div>
        )}

        {/* ── Active Request ── */}
        {activeRequest && (
          <div className="bg-white rounded-2xl p-5 mb-4 border-2 border-primary-200 animate-in zoom-in-95 fade-in duration-300">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center flex-shrink-0">
                <i className="ri-roadster-fill text-white text-sm" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground-950">{t(`status_${activeRequest.status}`)}</p>
                <p className="text-xs text-foreground-500">
                  {activeRequest.payment_method === 'cash' ? t('payment_cash') : activeRequest.payment_method === 'card' ? t('payment_card') : t('payment_online')}
                </p>
              </div>
              <div className="ml-auto text-right flex-shrink-0">
                <p className="text-lg font-bold text-primary-600 font-heading">
                  {parseFloat(String(activeRequest.estimated_price)).toFixed(2)} {t('lv')}
                </p>
                <p className="text-xs text-foreground-500">
                  {activeDistanceLabel()}
                </p>
              </div>
            </div>

            {/* Live in-app navigation map */}
            {navTarget && navTarget.lat != null && navTarget.lng != null && (
              <div
                className="mb-4 rounded-xl overflow-hidden border border-background-100"
                style={{ height: '360px' }}
              >
                <DriverRouteMap
                  targetLat={navTarget.lat}
                  targetLng={navTarget.lng}
                  driverId={driver?.id ?? null}
                  onNavInfo={setDriverNavInfo}
                />
              </div>
            )}

            {/* Route */}
            <div className="bg-background-50 rounded-xl p-3 mb-4">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                  <div className="w-3 h-3 rounded-full bg-primary-500 border-2 border-primary-200" />
                  <div className="w-0.5 h-8 bg-background-200 my-0.5" />
                  <div className="w-3 h-3 rounded bg-foreground-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground-900 truncate">{activeRequest.pickup_address}</p>
                  <p className="text-xs text-foreground-500 mt-4 truncate">{activeRequest.destination_address}</p>
                </div>
              </div>
            </div>

            {/* Navigation summary bar */}
            <div className="flex items-center gap-3 mb-4 bg-accent-50 rounded-xl p-3 border border-accent-100">
              <span className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0">
                <i className="ri-route-line text-accent-600 text-sm" />
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground-950">
                  {activeRequest.status === 'accepted' ? t('heading_to_pickup') : activeRequest.status === 'arrived' ? t('at_pickup') : t('heading_to_destination')}
                </p>
                <p className="text-xs text-foreground-500">
                  {activeRequest.status === 'arrived' ? activeRequest.pickup_address : activeRequest.status === 'in_progress' ? activeRequest.destination_address : activeRequest.pickup_address}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-foreground-950 font-heading leading-none">
                  {activeDurationLabel()}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2">
              {activeRequest.status === 'accepted' && (
                <button
                  onClick={() => arrivedMutation.mutate(activeRequest)}
                  className="w-full py-3.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] shadow-md shadow-primary-500/15"
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <i className="ri-map-pin-user-fill" />
                    {t('arrived')}
                  </span>
                </button>
              )}
              {activeRequest.status === 'arrived' && (
                <>
                  <button
                    onClick={() => startMutation.mutate(activeRequest)}
                    className="w-full py-3.5 rounded-xl bg-foreground-950 text-white text-sm font-semibold hover:bg-foreground-800 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <i className="ri-roadster-line" />
                    {t('start_trip')}
                  </button>
                  <div className="bg-accent-50 rounded-xl p-3 text-center">
                    <p className="text-sm text-accent-700 font-medium">{t('waiting_for_customer')}</p>
                    <p className="text-xs text-foreground-500 mt-1">{activeRequest.pickup_address}</p>
                  </div>
                </>
              )}
              {activeRequest.status === 'in_progress' && (
                <>
                  <button
                    onClick={() => endMutation.mutate(activeRequest)}
                    className="w-full py-3.5 rounded-xl bg-foreground-950 text-white text-sm font-semibold hover:bg-foreground-800 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <i className="ri-flag-line" />
                    {t('end_trip')}
                  </button>
                  <div className="bg-primary-50 rounded-xl p-3">
                    <p className="text-xs text-primary-700 font-medium flex items-center gap-1">
                      <i className="ri-map-pin-line text-primary-500" />
                      {t('destination_label')}: {activeRequest.destination_address}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Incoming Requests ── */}
        {!activeRequest && isOnline && (
          <>
            {incomingRequests.length === 0 ? (
              <div className="text-center py-16">
                <div className="w-16 h-16 rounded-full bg-background-100 flex items-center justify-center mx-auto mb-4">
                  <i className="ri-inbox-line text-3xl text-foreground-300" />
                </div>
                <p className="text-foreground-500 font-medium text-sm">{t('no_incoming_requests')}</p>
                <p className="text-foreground-400 text-xs mt-1">{t('go_online_to_receive')}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <p className="text-xs font-semibold text-foreground-400 uppercase tracking-wider">
                    {incomingRequests.length} {incomingRequests.length === 1 ? t('request_unit_one') : t('request_unit_other')}
                  </p>
                  <button
                    onClick={() => toggleMutation.mutate()}
                    disabled={toggling}
                    className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors cursor-pointer flex items-center gap-1"
                  >
                    <i className="ri-wifi-off-line" />
                    {t('toggle_off')}
                  </button>
                </div>
                {incomingRequests.map((req) => {
                  const stats = routeStats(req);
                  const isAccepting = acceptMutation.isPending && acceptMutation.variables === req.id;
                  return (
                    <div
                      key={req.id}
                      className="bg-white rounded-2xl p-4 animate-in fade-in slide-in-from-bottom-2 duration-300 border border-background-100"
                    >
                      {/* Route */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                          <div className="w-0.5 h-6 bg-background-200 my-0.5" />
                          <div className="w-2.5 h-2.5 rounded bg-foreground-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground-900 truncate">{req.pickup_address}</p>
                          <p className="text-xs text-foreground-500 mt-3 truncate">{req.destination_address}</p>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="flex items-center gap-3 mb-4 text-xs text-foreground-500 bg-background-50 rounded-xl p-2.5 flex-wrap">
                        <span className="flex items-center gap-1">
                          <i className="ri-road-map-line text-foreground-400" />
                          {stats.distance ? stats.distance.toFixed(1) : '0.0'} {t('km')}
                        </span>
                        <span className="text-background-200">|</span>
                        <span className="flex items-center gap-1">
                          <i className="ri-time-line text-foreground-400" />
                          {stats.duration ? stats.duration : '—'} {t('min')}
                        </span>
                        <span className="text-background-200">|</span>
                        <span className="flex items-center gap-1">
                          <i className="ri-wallet-3-line text-foreground-400" />
                          {req.payment_method === 'cash' ? t('payment_cash') : req.payment_method === 'card' ? t('payment_card') : t('payment_online')}
                        </span>
                      </div>

                      {/* Price + Accept */}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xl font-bold text-primary-600 font-heading">
                          {parseFloat(String(req.estimated_price)).toFixed(2)} {t('lv')}
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={() => decline(req.id)}
                            disabled={isDeclining}
                            className="px-4 py-2.5 rounded-xl bg-background-100 text-foreground-500 text-sm font-medium hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
                          >
                            {t('reject')}
                          </button>
                          <button
                            onClick={() => acceptMutation.mutate(req.id)}
                            disabled={isAccepting}
                            className="px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.97] disabled:opacity-60 shadow-md shadow-primary-500/15"
                          >
                            {isAccepting ? (
                              <span className="flex items-center gap-1.5">
                                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                {t('accepting_request')}
                              </span>
                            ) : (
                              t('accept')
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Time ago */}
                      <p className="text-[11px] text-foreground-400 mt-2.5">
                        {Math.floor((Date.now() - new Date(req.created_at).getTime()) / 60000)} {t('minutes_short')}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}