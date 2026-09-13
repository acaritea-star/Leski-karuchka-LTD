import { setDriverOnline } from '@/lib/driverLocation';
import { useDriverGps } from '@/components/feature/DriverGpsProvider';
/* global google */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';

import BottomNav from '@/components/feature/BottomNav';
import EnableNotificationsBanner from '@/components/feature/EnableNotificationsBanner';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import { useDriverDeclines } from '@/hooks/useDriverDeclines';
import { LOGO_URL } from '@/lib/logo';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { BULGARIA_CENTER } from '@/lib/geo';

type DriverRecord = Tables<'drivers'>;
type TaxiRequest = Tables<'taxi_requests'>;

export default function DriverHome() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playDriverSound, unlockAudio } = useNotificationSound();

  const [toggleError, setGpsError] = useState('');
  const gps = useDriverGps();
  const gpsError = toggleError || gps.error;
  const gpsStatus = gps.status;
  const requestChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Unlock audio on first user interaction (browsers block AudioContext until then)
  useEffect(() => {
    const handler = () => unlockAudio();
    document.addEventListener('click', handler, { once: true });
    document.addEventListener('touchstart', handler, { once: true });
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [unlockAudio]);

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
  const { declinedIds, decline } = useDriverDeclines(driver?.id);

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

  // ── Today stats ──
  const todayStatsQuery = useQuery({
    queryKey: driver?.id ? queryKeys.driverTodayStats(driver.id) : ['taxi_requests', 'driver', 'none', 'today'],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('taxi_requests')
        .select('estimated_price, final_price, status')
        .eq('driver_id', driver!.id)
        .eq('status', 'completed')
        .gte('completed_at', today.toISOString())
        .lt('completed_at', new Date(today.getTime() + 86400000).toISOString());
      if (error) throw error;
      const trips = data?.length ?? 0;
      const earnings = (data ?? []).reduce(
        (sum, r) => sum + Number(r.final_price ?? r.estimated_price ?? 0),
        0,
      );
      return { trips, earnings };
    },
    enabled: !!driver?.id,
  });
  const todayStats = todayStatsQuery.data ?? { trips: 0, earnings: 0 };

  // ── Pending count ──
  const pendingCountQuery = useQuery({
    queryKey: user?.company_id ? queryKeys.driverPendingCount(user.company_id) : ['taxi_requests', 'company', 'none', 'pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('taxi_requests')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', user!.company_id!)
        .eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user?.company_id && !!driver?.is_online,
    refetchInterval: driver?.is_online ? 8000 : false,
  });
  const pendingRequests = pendingCountQuery.data ?? 0;

  // ── Pending list (to surface the next non-declined request) ──
  const pendingListQuery = useQuery({
    queryKey: user?.company_id ? queryKeys.driverPendingList(user.company_id) : ['taxi_requests', 'company', 'none', 'pending-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('company_id', user!.company_id!)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.company_id && !!driver?.is_online,
    refetchInterval: driver?.is_online ? 8000 : false,
  });

  const latestRequest = useMemo(() => {
    const list = pendingListQuery.data ?? [];
    return list.find((r) => !declinedIds.has(r.id)) ?? null;
  }, [pendingListQuery.data, declinedIds]);

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
      const { data, error } = await supabase
        .from('taxi_requests')
        .update({ driver_id: driver.id, status: 'accepted', accepted_at: new Date().toISOString() })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (driver?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      }
      if (user?.company_id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingCount(user.company_id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.company_id) });
      }
      navigate('/driver/requests');
    },
    onError: () => {
      if (user?.company_id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingCount(user.company_id) });
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.company_id) });
      }
    },
  });

  const declineRequest = () => {
    if (latestRequest) decline(latestRequest.id);
  };

  // ── Realtime: taxi_requests ──
  useEffect(() => {
    if (!driver?.id || !user?.company_id) return;
    const companyId = user.company_id;

    const channel = supabase
      .channel(`driver-requests-${driver.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'taxi_requests', filter: 'status=eq.pending' },
        (payload) => {
          const newRow = payload.new as TaxiRequest;
          if (driver.is_online && newRow.company_id === companyId && newRow.status === 'pending') {
            queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingCount(companyId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(companyId) });
            playDriverSound();
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
          } else if (['completed', 'cancelled'].includes(newRow.status)) {
            queryClient.setQueryData(queryKeys.driverActiveRequest(driver.id), null);
            queryClient.invalidateQueries({ queryKey: queryKeys.driverTodayStats(driver.id) });
          }
        },
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'taxi_requests' }, (payload) => {
        const oldRow = payload.old as Partial<TaxiRequest> | undefined;
        const newRow = payload.new as TaxiRequest;
        if (oldRow?.status === 'pending' && newRow.status !== 'pending' && newRow.company_id === companyId) {
          queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingCount(companyId) });
          queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(companyId) });
        }
      })
      .subscribe();

    requestChannelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, driver?.is_online, user?.company_id, queryClient, playDriverSound]);

  // ── Decorative Google Maps background ──
  const mapBgRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = mapBgRef.current;
    if (!el) return;
    let cancelled = false;
    let mapInstance: google.maps.Map | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        mapInstance = new google.maps.Map(el, {
          center: { lat: BULGARIA_CENTER.lat, lng: BULGARIA_CENTER.lng },
          zoom: 14,
          disableDefaultUI: true,
          gestureHandling: 'none',
          keyboardShortcuts: false,
          draggable: false,
          scrollwheel: false,
          fullscreenControl: false,
        });

        // Center the background on the driver's own location when available
        if ('geolocation' in navigator) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              if (cancelled || !mapInstance) return;
              const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
              mapInstance.setCenter(here);
              mapInstance.setZoom(16);

              const svg =
                '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">' +
                '<circle cx="11" cy="11" r="10" fill="#2563eb" fill-opacity="0.22"/>' +
                '<circle cx="11" cy="11" r="5.5" fill="#2563eb" stroke="#ffffff" stroke-width="2.5"/></svg>';
              new google.maps.Marker({
                position: here,
                map: mapInstance,
                icon: {
                  url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
                  scaledSize: new google.maps.Size(22, 22),
                  anchor: new google.maps.Point(11, 11),
                },
              });
            },
            () => {
              /* ignore */
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
          );
        }
      })
      .catch(() => {
        /* decorative — ignore load failures */
      });
    return () => {
      cancelled = true;
      if (mapInstance) {
        google.maps.event.clearInstanceListeners(mapInstance);
      }
    };
  }, []);

  if (authLoading || driverQuery.isLoading) {
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
  const accepting = acceptMutation.isPending;

  return (
    <div className="relative min-h-screen bg-background-50 overflow-hidden">
      {/* MAP BACKGROUND */}
      <div className="fixed inset-0 z-0 h-[100vh]">
        <div ref={mapBgRef} className="w-full h-full pointer-events-none select-none" />
        <div className="absolute inset-0 bg-gradient-to-b from-background-50/60 via-transparent to-background-50/95" />
      </div>

      {/* CONTENT */}
      <div className="relative z-10 flex flex-col min-h-screen">
        {/* Header — refined */}
        <header className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={LOGO_URL} alt={t('app_name')} className="h-7 w-auto rounded-md bg-white shadow-sm" />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground-950 font-heading leading-tight tracking-tight">{t('app_name')}</span>
              <span className="text-[10px] font-semibold text-foreground-500 leading-none">{t('role_driver')}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {pendingRequests > 0 && (
              <button
                onClick={() => navigate('/driver/requests')}
                className="relative w-9 h-9 flex items-center justify-center rounded-full bg-white/80 backdrop-blur hover:bg-white transition-colors cursor-pointer shadow-sm"
              >
                <i className="ri-notification-3-line text-foreground-600 text-base" />
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center animate-pulse">
                  {pendingRequests > 9 ? '9+' : pendingRequests}
                </span>
              </button>
            )}
            <button
              onClick={() => navigate('/driver/profile')}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/80 backdrop-blur hover:bg-white transition-colors cursor-pointer shadow-sm"
            >
              <i className="ri-user-3-line text-foreground-600 text-base" />
            </button>
          </div>
        </header>

        {/* Enable push notifications (iOS requires a user tap) */}
        <EnableNotificationsBanner />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom panel */}
        <div className="px-3 md:px-6 pb-safe-nav">
          <div className="mx-auto w-full max-w-md space-y-2.5">
            {/* Incoming Request Card — first priority */}
            {latestRequest && !activeRequest && driver?.is_online && (
              <div className="bg-white/95 backdrop-blur-xl rounded-2xl border-2 border-primary-300 p-4 animate-in zoom-in-95 fade-in duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center animate-pulse flex-shrink-0">
                    <i className="ri-notification-3-line text-white text-xs" />
                  </div>
                  <p className="text-sm font-bold text-foreground-950">{t('new_request')}</p>
                  <span className="ml-auto text-xs text-foreground-500">
                    {latestRequest.payment_method === 'cash' ? t('payment_cash') : latestRequest.payment_method === 'card' ? t('payment_card') : t('payment_online')}
                  </span>
                </div>
                <div className="flex items-start gap-2.5 mb-3">
                  <div className="flex flex-col items-center flex-shrink-0 pt-1">
                    <div className="w-2 h-2 rounded-full bg-primary-500" />
                    <div className="w-px h-5 bg-background-200 my-0.5" />
                    <div className="w-2 h-2 rounded-sm bg-foreground-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground-900 truncate">{latestRequest.pickup_address}</p>
                    <p className="text-xs text-foreground-500 mt-3 truncate">{latestRequest.destination_address}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-base font-bold text-primary-600 font-heading">
                      {parseFloat(String(latestRequest.estimated_price)).toFixed(2)} {t('lv')}
                    </p>
                    <p className="text-xs text-foreground-500">
                      {parseFloat(String(latestRequest.estimated_distance_km)).toFixed(1)} {t('km')}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={declineRequest}
                    className="py-2.5 rounded-xl bg-background-100 text-foreground-600 text-sm font-semibold hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98]"
                  >
                    {t('reject')}
                  </button>
                  <button
                    onClick={() => acceptMutation.mutate(latestRequest.id)}
                    disabled={accepting}
                    className="py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-1"
                  >
                    {accepting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t('accepting_request')}
                      </>
                    ) : (
                      t('accept')
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Active Request Card */}
            {activeRequest && (
              <button
                onClick={() => navigate('/driver/requests')}
                className="w-full bg-white/95 backdrop-blur-xl rounded-2xl border border-primary-200 p-4 text-left cursor-pointer animate-in zoom-in-95 fade-in duration-300 hover:border-primary-400 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <i className="ri-user-star-line text-primary-600 text-xs" />
                  </div>
                  <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide">{t('new_request')}</p>
                  <span className="ml-auto text-xs text-foreground-500">{t(`status_${activeRequest.status}`)}</span>
                </div>
                <div className="flex items-start gap-2">
                  <div className="flex flex-col items-center flex-shrink-0 pt-1">
                    <div className="w-2 h-2 rounded-full bg-primary-500" />
                    <div className="w-px h-4 bg-background-200 my-0.5" />
                    <div className="w-2 h-2 rounded-sm bg-foreground-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground-800 truncate">{activeRequest.pickup_address}</p>
                    <p className="text-xs text-foreground-500 mt-2.5 truncate">{activeRequest.destination_address}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-sm font-bold text-primary-600 font-heading">
                      {parseFloat(String(activeRequest.estimated_price)).toFixed(2)} {t('lv')}
                    </span>
                    <i className="ri-arrow-right-s-line text-foreground-300 text-base" />
                  </div>
                </div>
              </button>
            )}

            {/* Main bottom panel: toggle + stats */}
            <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-background-100 p-4">
              {/* Online / Offline toggle — more prominent */}
              <button
                onClick={() => toggleMutation.mutate()}
                disabled={toggling}
                className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-300 whitespace-nowrap cursor-pointer relative overflow-hidden mb-3
                  ${toggling ? 'opacity-70' : 'active:scale-[0.98]'}
                  ${driver?.is_online
                    ? 'bg-primary-500 text-white'
                    : 'bg-foreground-950 text-white hover:bg-foreground-800'
                  }`}
              >
                {toggling ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    {driver?.is_online ? t('toggle_off') : t('toggle_on')}
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2.5">
                    <div className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${driver?.is_online ? 'bg-white animate-pulse' : 'bg-red-400'}`} />
                    {driver?.is_online ? t('you_are_online') : t('you_are_offline')}
                  </span>
                )}
              </button>

              {gpsError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2 flex items-center gap-2">
                  <i className="ri-error-warning-line text-red-500 text-sm" />
                  <p className="text-xs text-red-600 font-medium">{gpsError}</p>
                </div>
              )}
              {driver?.is_online && !gpsError && (
                <div className={`rounded-xl px-3 py-2 mb-3 flex items-center gap-2 ${
                  gpsStatus === 'tracking'
                    ? 'bg-emerald-50 border border-emerald-200'
                    : gpsStatus === 'stale'
                      ? 'bg-amber-50 border border-amber-200'
                      : 'bg-background-100'
                }`}>
                  <span className={`w-2 h-2 rounded-full ${
                    gpsStatus === 'tracking'
                      ? 'bg-emerald-500 animate-pulse'
                      : gpsStatus === 'stale'
                        ? 'bg-amber-500'
                        : 'bg-foreground-300'
                  }`} />
                  <span className={`text-xs font-medium ${
                    gpsStatus === 'tracking'
                      ? 'text-emerald-700'
                      : gpsStatus === 'stale'
                        ? 'text-amber-700'
                        : 'text-foreground-500'
                  }`}>
                    {gpsStatus === 'tracking' && t('gps_live_shared')}
                    {gpsStatus === 'stale' && t('gps_weak_signal')}
                    {gpsStatus === 'idle' && t('gps_updating')}
                  </span>
                </div>
              )}
              {!driver?.is_online && (
                <p className="text-xs text-foreground-400 text-center mb-3">{t('go_online_to_receive')}</p>
              )}

              {/* Stats row — refined */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">{todayStats.trips}</p>
                  <p className="text-[10px] text-foreground-500">{t('todays_trips')}</p>
                </div>
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">
                    {todayStats.earnings.toFixed(0)}<span className="text-xs font-normal text-foreground-400"> {t('lv')}</span>
                  </p>
                  <p className="text-[10px] text-foreground-500">{t('todays_earnings')}</p>
                </div>
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">
                    {parseFloat(String(driver?.rating || 0)).toFixed(1)}
                  </p>
                  <p className="text-[10px] text-foreground-500">{t('driver_rating')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <BottomNav
        items={[
          { path: '/driver/home', labelKey: 'nav_home', icon: 'ri-home-4-line', iconActive: 'ri-home-4-fill' },
          { path: '/driver/requests', labelKey: 'nav_requests', icon: 'ri-file-list-3-line', iconActive: 'ri-file-list-3-fill', badge: pendingRequests },
          { path: '/driver/history', labelKey: 'nav_history', icon: 'ri-history-line', iconActive: 'ri-history-fill' },
          { path: '/driver/earnings', labelKey: 'nav_earnings', icon: 'ri-money-dollar-circle-line', iconActive: 'ri-money-dollar-circle-fill' },
        ]}
      />
    </div>
  );
}