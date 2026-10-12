import { useDriverOfferConnection } from '@/hooks/useDriverOfferConnection';
import { useDriverDispatchIdentity } from '@/hooks/useDriverDispatchIdentity';
import { loadDriverDay } from '@/lib/serverSummaries';
import { useSofiaDay } from '@/hooks/useSofiaDay';
import { acceptTaxiRequest } from '@/lib/rideOperations';
import { cacheDriverRequest } from '@/lib/driverRequestCache';
import { driverRecordOptions } from '@/lib/driverRecord';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { useFreshRequests, isOpenRequest } from '@/hooks/useFreshRequests';
import { mergeDriverActiveRead } from '@/lib/requestSnapshot';
import { getGpsPosition, subscribeGpsState } from '@/lib/sharedGps';
import { ensureDriverLocation, setDriverOnline } from '@/lib/driverLocation';
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
  const day = useSofiaDay();
  const { user, loading: authLoading } = useAuth();
  const activeOwner = useRef(user?.id);
  activeOwner.current = user?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playDriverSound, unlockAudio } = useNotificationSound();

  const toggleInFlight = useRef(false);
  const acceptInFlight = useRef(false);
  const [toggleError, setGpsError] = useState('');
  const [offerError, setOfferError] = useState('');
  const gps = useDriverGps();
  const gpsError = toggleError || gps.error;
  const gpsStatus = gps.status;
  const [requestsRealtime, setRequestsRealtime] = useState(false);
  const offersConnected = useDriverOfferConnection();

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
  const driverQuery = useQuery(driverRecordOptions(user?.id));
  const driver = driverQuery.data ?? null;
  const identity = useDriverDispatchIdentity(user?.id, driver?.vehicle_id);
  const readyForRequests = !!driver?.is_online && gpsStatus === 'tracking';

  // ── Active request ──
  const activeRequestQuery = useQuery({
    queryKey: driver?.id ? queryKeys.driverActiveRequest(driver.id) : ['taxi_requests', 'driver', 'none', 'active'],
    queryFn: async ({ signal }) => {
      const key = queryKeys.driverActiveRequest(driver!.id);
      const started = queryClient.getQueryData<TaxiRequest | null>(key);
      const { data, error } = await withRequestTimeout(abort => supabase
        .from('taxi_requests')
        .select('*')
        .eq('driver_id', driver!.id)
        .in('status', ['accepted', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1)
        .abortSignal(abort).maybeSingle(), 10_000, signal);
      if (error) throw error;
      return mergeDriverActiveRead(started, queryClient.getQueryData<TaxiRequest | null>(key), data);
    },
    enabled: !!driver?.id,
    refetchInterval: requestsRealtime ? 30_000 : 8000,
  });
  const activeRequest = activeRequestQuery.data ?? null;

  // ── Today stats ──
  const todayStatsQuery = useQuery({
    queryKey: driver?.id ? queryKeys.driverTodayStats(driver.id, day) : ['taxi_requests', 'driver', 'none', 'today'],
    queryFn: ({ signal }) => loadDriverDay(driver!.id, signal),
    enabled: !!driver?.id,
  });
  const todayStats = todayStatsQuery.data ?? { trips: 0, earnings: 0 };

  // ── Pending list (to surface the next non-declined request) ──
  const pendingListQuery = useQuery({
    queryKey: user?.id ? queryKeys.driverPendingList(user.id) : ['taxi_requests', 'company', 'none', 'pending-list'],
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase
        .rpc('driver_incoming_requests', { p_limit: 50 }).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.company_id && !!driver?.is_online && !activeRequest,
    refetchInterval: offersConnected ? 30_000 : 8000,
  });
  // The badge renders 9+ beyond nine; the existing ten-row snapshot is enough.
  const freshPending = useFreshRequests(pendingListQuery.data ?? []);
  const heardOffers = useRef(new Set<string>());
  useEffect(() => { heardOffers.current = new Set(); }, [driver?.id]);
  useEffect(() => {
    if (!driver?.is_online) return;
    const newOffers = freshPending.filter(row => !heardOffers.current.has(row.id));
    for (const row of freshPending) heardOffers.current.add(row.id);
    if (newOffers.length) playDriverSound();
    if (heardOffers.current.size > 200) heardOffers.current = new Set(freshPending.map(row => row.id));
  }, [freshPending, driver?.is_online, playDriverSound]);

  const { declinedIds, decline, declineError, declinesReady, declinesLoadError, refreshDeclines } = useDriverDeclines(driver?.id, freshPending.map(r => r.id));
  const refusalError = declineError || declinesLoadError;
  const displayedError = gpsError || (refusalError ? refusalError instanceof Error ? refusalError.message : 'Отказът не е потвърден. Обнови заявките.' : '');
  const pendingRequests = driver?.is_online && !activeRequest && declinesReady ? freshPending.filter(r => !declinedIds.has(r.id)).length : 0;

  const latestRequest = useMemo(() => {
    return declinesReady ? freshPending.find((r) => !declinedIds.has(r.id)) ?? null : null;
  }, [freshPending, declinedIds, declinesReady]);

  // ── Toggle online / offline ──
  const toggleMutation = useMutation({
    retry: false,
    onMutate: () => ({ owner: user?.id }),
    mutationFn: async (goingOnline: boolean) => {
      if (!driver) throw new Error('No driver record');

      return await setDriverOnline(driver, goingOnline);
    },
    onSuccess: async (confirmed, _target, context) => {
      if (context?.owner !== activeOwner.current) return;
      if (confirmed.id !== driver?.id) return;
      if (user?.id) await queryClient.cancelQueries({ queryKey: queryKeys.driverRecord(user.id) });
      if (user?.id) queryClient.setQueryData(queryKeys.driverRecord(user.id), confirmed);
      setGpsError('');
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverRecord(user.id) });
      }
    },
    onSettled: () => { toggleInFlight.current = false; },
    onError: (err, _target, context) => {
      if (context?.owner !== activeOwner.current) return;
      setGpsError(err instanceof Error ? err.message : t('gps_error'));
    },
  });

  // ── Accept request ──
  const acceptMutation = useMutation({
    retry: false,
    onMutate: () => ({ owner: user?.id }),
    mutationFn: async (requestId: string) => {
      if (!driver) throw new Error('No driver record');
      const request = latestRequest;
      if (!request || request.id !== requestId || !isOpenRequest(request)) throw new Error('Заявката вече не е налична. Списъкът се обновява.');
      const owner = user?.id;
      await ensureDriverLocation(driver);
      if (owner !== activeOwner.current) throw new DOMException('Account changed', 'AbortError');
      if (!isOpenRequest(request)) throw new Error('Заявката изтече, докато обновявахме GPS. Изчакай следващата.');
      const confirmed = await acceptTaxiRequest(requestId, driver.id);
      if (owner !== activeOwner.current) throw new DOMException('Account changed', 'AbortError');
      return confirmed;
    },
    onSettled: () => { acceptInFlight.current = false; },
    onSuccess: (confirmed, _requestId, context) => {
      if (context?.owner !== activeOwner.current) return;
      if (confirmed.driver_id !== driver?.id) return;
      setOfferError('');
      if (driver?.id) {
        cacheDriverRequest(queryClient, driver.id, confirmed);
      }
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.id) });
      }
      navigate('/driver/requests');
    },
    onError: (err, _requestId, context) => {
      if (context?.owner !== activeOwner.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (driver?.id) queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      setOfferError(err instanceof Error ? err.message : t('request_missed'));
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.id) });
      }
    },
  });
  const acceptRequest = (id: string) => {
    if (acceptInFlight.current) return;
    if (!latestRequest || latestRequest.id !== id || !isOpenRequest(latestRequest)) {
      setOfferError('Заявката вече не е налична. Списъкът се обновява.');
      if (user?.id) void queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.id) });
      return;
    }
    setOfferError('');
    acceptInFlight.current = true; acceptMutation.mutate(id);
  };

  const declineRequest = () => {
    if (latestRequest) decline(latestRequest.id);
  };

  // ── Realtime: taxi_requests ──
  useEffect(() => {
    if (!driver?.id || !user?.id) return;
    setRequestsRealtime(false);

    const channel = supabase
      .channel('driver-requests-' + driver.id)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'taxi_requests', filter: `driver_id=eq.${driver.id}` },
        (payload) => {
          const newRow = payload.new as TaxiRequest;
          if (['accepted', 'arrived', 'in_progress'].includes(newRow.status)) {
            cacheDriverRequest(queryClient, driver.id, newRow);
          } else if (['completed', 'cancelled'].includes(newRow.status)) {
            cacheDriverRequest(queryClient, driver.id, newRow);
            queryClient.invalidateQueries({ queryKey: queryKeys.driverTodayStats(driver.id) });
          }
        },
      )
      .subscribe(status => {
        setRequestsRealtime(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) }, { cancelRefetch: false });
          queryClient.invalidateQueries({ queryKey: queryKeys.driverPendingList(user.id) }, { cancelRefetch: false });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, driver?.is_online, user?.id, queryClient]);

  // ── Decorative Google Maps background ──
  const [mapOpened, setMapOpened] = useState(false);
  const mapBgRef = useRef<HTMLDivElement | null>(null);
  const refreshMap = useRef<() => void>(() => {});
  useEffect(() => {
    const el = mapBgRef.current;
    if (!el || !mapOpened) return;
    let cancelled = false;
    let mapInstance: google.maps.Map | null = null;
    let marker: google.maps.Marker | null = null;
    let unsubscribe = () => {};

    loadGoogleMaps()
      .then(() => {
        if (cancelled) return;
        mapInstance = new google.maps.Map(el, {
          center: { lat: BULGARIA_CENTER.lat, lng: BULGARIA_CENTER.lng },
          zoom: 7,
          disableDefaultUI: true,
          gestureHandling: 'none',
          keyboardShortcuts: false,
          draggable: false,
          scrollwheel: false,
          fullscreenControl: false,
        });

        // Observe the shared fix; this decorative map never asks for GPS itself.
        const center = () => {
          if (!el.closest('details')?.open) return;
          const pos = getGpsPosition();
          if (cancelled || !mapInstance) return;
          if (!pos) { marker?.setMap(null); marker = null; return; }
          if (Date.now() - pos.timestamp > 45_000) { marker?.setMap(null); marker = null; return; }
          const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (marker) { marker.setPosition(here); mapInstance.setCenter(here); return; }
          mapInstance.setCenter(here); mapInstance.setZoom(16);
          const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><circle cx="11" cy="11" r="10" fill="#2563eb" fill-opacity="0.22"/><circle cx="11" cy="11" r="5.5" fill="#2563eb" stroke="#ffffff" stroke-width="2.5"/></svg>';
          marker = new google.maps.Marker({ position: here, map: mapInstance,
            icon: { url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
              scaledSize: new google.maps.Size(22, 22), anchor: new google.maps.Point(11, 11) } });
        };
        refreshMap.current = center;
        center(); unsubscribe = subscribeGpsState(center);
      })
      .catch(() => {
        /* decorative — ignore load failures */
      });
    return () => {
      cancelled = true; unsubscribe(); marker?.setMap(null); refreshMap.current = () => {};
      if (mapInstance) {
        google.maps.event.clearInstanceListeners(mapInstance);
      }
    };
  }, [authLoading, driverQuery.isLoading, mapOpened]);

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
    <div className="brand-scope min-h-screen bg-background-50">
      {/* CONTENT */}
      <div className="flex flex-col min-h-screen">
        {/* Header — refined */}
        <header className="px-4 py-3 flex items-center justify-between bg-white border-b border-background-200 sticky top-0 z-30">
          <div className="flex items-center gap-2.5">
            <img src={LOGO_URL} alt={t('app_name')} className="h-7 w-14 object-contain shrink-0 rounded-md bg-white shadow-sm" />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground-950 font-heading leading-tight tracking-tight">{t('app_name')}</span>
              <span className="text-[10px] font-semibold text-foreground-500 leading-none">{t('role_driver')}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {pendingRequests > 0 && (
              <button
                onClick={() => navigate('/driver/requests')}
                aria-label="Входящи заявки"
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
              aria-label="Профил и документи"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/80 backdrop-blur hover:bg-white transition-colors cursor-pointer shadow-sm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0116 0v2" /></svg>
            </button>
          </div>
        </header>

        {/* Bottom panel */}
        <main className="px-4 md:px-6 pt-5 pb-safe-nav">
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <section aria-label="Твоят работен статус" className="space-y-2">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-foreground-500">ШОФЬОРСКИ ПАНЕЛ</p>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${activeRequest ? 'bg-secondary-100 text-secondary-800' : readyForRequests ? 'bg-primary-100 text-primary-800' : driver?.is_online ? 'bg-amber-100 text-amber-800' : 'bg-background-200 text-foreground-600'}`}>{activeRequest ? 'В курс' : driver?.is_online ? readyForRequests ? 'Онлайн' : 'Изчаква GPS' : driver && !driver.is_verified ? 'Подготовка' : 'Офлайн'}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-heading font-bold text-foreground-950 break-words">Здравей{user?.first_name ? ', ' + user.first_name : ''}!</h1>
              <p className="text-sm text-foreground-500">{activeRequest ? 'Имаш текущ курс. Отвори го, за да продължиш.' : !driver ? 'Шофьорският запис не е зареден. Провери профила си или обнови статуса.' : !driver.is_verified ? 'Довърши подготовката и документите. Фирмата ще потвърди профила ти.' : driver.is_online ? readyForRequests ? 'Готов си за подходящите заявки около теб.' : 'Онлайн режимът е включен, но изчакваме актуален GPS. Докато няма потвърдена позиция, не си достъпен за нови заявки.' : 'Включи онлайн, когато си готов да получаваш заявки.'}</p>
              {identity.data?.company && <p className="text-sm text-foreground-700"><strong>Фирма: {identity.data.company}</strong>{identity.data.category && <> · Категория: {identity.data.category}</>}<span className="block text-xs text-foreground-500 mt-1">Получаваш заявки в радиуса на фирмата, когато клиентът избере вашата оферта. Цената е по вашата тарифа.</span></p>}
            </section>
            {driver && !driver.is_verified && !activeRequest && <section className="rounded-2xl border border-primary-200 bg-primary-50 p-4 space-y-3" aria-label="Подготовка за работа">
              <h2 className="font-semibold text-foreground-950">Следваща стъпка: профил и документи</h2>
              <p className="text-sm text-foreground-600">Условия и обучение → документи и автомобил → одобрение от фирмата.</p>
              <button type="button" onClick={() => navigate('/driver/profile')} className="rounded-xl bg-primary-500 px-4 py-3 text-sm text-white font-semibold">Продължи подготовката</button>
            </section>}
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
                    onClick={() => acceptRequest(latestRequest.id)}
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
                  <p className="text-sm font-semibold text-primary-700">Текущ курс</p>
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
                <p className="mt-3 pt-3 border-t border-background-100 text-sm text-primary-700 font-semibold flex items-center justify-between">Отвори текущия курс<i className="ri-arrow-right-line" aria-hidden="true" /></p>
              </button>
            )}

            {offerError && <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800" role="status">{offerError}</div>}
            {/* Main bottom panel: toggle + stats */}
            <section className="bg-white rounded-2xl border border-background-200 p-4 md:p-5" aria-label="Онлайн режим">
              <div className="flex justify-between items-center gap-3 mb-3"><h2 className="font-semibold text-foreground-950">{activeRequest ? 'Твоят режим' : 'Готов ли си за заявки?'}</h2><span className="text-xs text-foreground-500">{driver?.is_online ? 'Включен' : 'Изключен'}</span></div>
              {/* Online / Offline toggle — more prominent */}
              <button
                onClick={() => {
                  if (toggleInFlight.current || !driver || !user?.id) return;
                  toggleInFlight.current = true;
                  const goingOnline = !driver.is_online;
                  void queryClient.cancelQueries({ queryKey: queryKeys.driverRecord(user.id) }).then(() => toggleMutation.mutate(goingOnline));
                }}
                disabled={toggling || !driver || (!driver.is_verified && !driver.is_online)}
                className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-300 whitespace-nowrap cursor-pointer relative overflow-hidden mb-3
                  ${toggling ? 'opacity-70' : 'active:scale-[0.98]'} disabled:opacity-50 disabled:cursor-not-allowed
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
                    {driver?.is_online ? 'Излез офлайн' : driver && !driver.is_verified ? 'Очаква верификация' : 'Включи онлайн'}
                  </span>
                )}
              </button>

              {(!driver || !driver.is_verified) && <p className="text-xs text-foreground-600 my-3">{driver ? 'Онлайн режимът се отключва след одобрението.' : 'Няма потвърден шофьорски запис.'} <button type="button" className="underline text-primary-700" onClick={() => void driverQuery.refetch()}>Обнови статуса</button></p>}
              {displayedError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2 flex items-center gap-2">
                  <i className="ri-error-warning-line text-red-500 text-sm" />
                  <p className="text-xs text-red-600 font-medium">{displayedError}</p>
                  {declinesLoadError && <button className="text-xs underline" onClick={() => void refreshDeclines()}>Обнови заявките</button>}
                </div>
              )}
              {driver?.is_online && gpsStatus !== 'tracking' && <button type="button" className="text-sm text-primary-700 underline mb-3" disabled={gps.retrying} onClick={gps.retryLocation}>{gps.retrying ? 'Обновяване на GPS…' : 'Обнови GPS'}</button>}
              {driver?.is_online && !displayedError && (
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
            </section>
            <section className="bg-white rounded-2xl border border-background-200 p-4 md:p-5" aria-label="Твоят ден">
              <div className="flex items-center justify-between gap-3 mb-3"><h2 className="font-semibold text-foreground-950">Твоят ден</h2><button type="button" onClick={() => navigate('/driver/earnings')} className="text-xs text-primary-700 font-semibold underline">Към отчета</button></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">{todayStatsQuery.data ? todayStats.trips : '—'}</p>
                  <p className="text-[10px] text-foreground-500">{t('todays_trips')}</p>
                </div>
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">
                    {todayStatsQuery.data ? todayStats.earnings.toFixed(2) : '—'}<span className="text-xs font-normal text-foreground-400"> {t('lv')}</span>
                  </p>
                  <p className="text-[10px] text-foreground-500">Стойност на курсовете</p>
                </div>
                <div className="bg-background-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-bold text-foreground-950 font-heading">
                    {driver ? parseFloat(String(driver.rating || 0)).toFixed(1) : '—'}
                  </p>
                  <p className="text-[10px] text-foreground-500">{t('driver_rating')}</p>
                </div>
              </div>
              <p className="text-xs text-foreground-500 mt-3">Реалните плащания и разходи записваш в отчета.</p>
            </section>
            <details className="rounded-2xl border border-background-200 bg-white overflow-hidden" onToggle={event => { if (event.currentTarget.open) { setMapOpened(true); refreshMap.current(); } }}>
              <summary className="p-4 cursor-pointer text-sm font-semibold text-foreground-600">Карта</summary>
              <p className="px-4 pb-3 text-xs text-foreground-500">Местоположението се показва при актуален GPS сигнал. Навигацията е в текущия курс.</p>
              {mapOpened && <div ref={mapBgRef} aria-label="Карта на местоположението" className="h-56 w-full pointer-events-none select-none" />}
            </details>
            <EnableNotificationsBanner />
          </div>
        </main>
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
