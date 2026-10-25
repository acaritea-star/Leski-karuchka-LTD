import PageLoading from '@/components/feature/LoadingState';
import BackButton from '@/components/feature/BackButton';
import { useDriverOfferConnection } from '@/hooks/useDriverOfferConnection';
import { useDriverDispatchIdentity } from '@/hooks/useDriverDispatchIdentity';
import { useFreshRequests, isOpenRequest } from '@/hooks/useFreshRequests';
import { acceptTaxiRequest, transitionTaxiRequest } from '@/lib/rideOperations';
import { cacheDriverRequest } from '@/lib/driverRequestCache';
import { endRideTrip } from '@/lib/ridePayment';
import { useDriverPaymentReceipt } from '@/hooks/useDriverPaymentNotice';
import DriverWallet from '@/pages/driver/components/DriverWallet';
import { driverRecordOptions } from '@/lib/driverRecord';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { driverActiveRequestOptions } from '@/lib/driverActiveRequest';
import { ensureDriverLocation, setDriverOnline } from '@/lib/driverLocation';
import { useDriverGps } from '@/components/feature/DriverGpsProvider';
import { lazy, Suspense, useState, useEffect, useRef } from 'react';
const RideCheckout = lazy(() => import('@/pages/driver/components/RideCheckout'));
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { useNotificationSound } from '@/hooks/useNotificationSound';
import type { Tables } from '@/lib/database.types';
import { calculateDistance, estimateDuration } from '@/lib/geo';
import DriverRouteMap, { type NavInfo } from '@/pages/driver/components/DriverRouteMap';
import { useDriverDeclines } from '@/hooks/useDriverDeclines';

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
  const toggleInFlight = useRef(false);
  const acceptInFlight = useRef(false);
  const { user } = useAuth();
  const activeOwner = useRef(user?.id);
  activeOwner.current = user?.id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { playDriverSound, unlockAudio } = useNotificationSound();

  const [toggleError, setGpsError] = useState('');
  const gps = useDriverGps();
  const gpsError = toggleError || gps.error;
  const [error, setError] = useState('');
  const [requestsRealtime, setRequestsRealtime] = useState(false);
  const offersConnected = useDriverOfferConnection();
  const [checkoutOwner, setCheckoutOwner] = useState('');
  const [checkoutRequest, setCheckoutRequest] = useState<TaxiRequest | null>(null);
  const [manualNotice,setManualNotice]=useState<{owner:string;driverId:string}|null>(null);
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


  // ── Driver record ──
  const driverQuery = useQuery(driverRecordOptions(user?.id));
  const driver = driverQuery.data ?? null;
  const identity = useDriverDispatchIdentity(user?.id, driver?.vehicle_id);
  const isOnline = driver?.is_online ?? false;

  // ── Active request ──
  const activeRequestQuery = useQuery({
    ...driverActiveRequestOptions(queryClient, driver?.id),
    refetchInterval: requestsRealtime ? 30_000 : 8000,
  });
  const activeRequest = activeRequestQuery.data ?? null;
  const paidReceipt=useDriverPaymentReceipt(user?.id,driver?.id,activeRequest?.id);

  // Reset nav info when active request changes (pickup → destination switch)
  useEffect(() => {
    if(activeRequest?.id)setManualNotice(null);
    setDriverNavInfo(null);
    setError('');
  }, [activeRequest?.id, activeRequest?.status]);

  // ── Incoming requests ──
  const incomingQuery = useQuery({
    queryKey: user?.id ? queryKeys.driverIncomingRequests(user.id) : ['taxi_requests', 'company', 'none', 'incoming'],
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase
        .rpc('driver_incoming_requests', { p_limit: 50 }).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user?.company_id && isOnline && !!driver?.id && !activeRequest,
    refetchInterval: offersConnected ? 30_000 : 8000,
  });
  const freshIncoming = useFreshRequests(incomingQuery.data ?? []);
  const heardOffers = useRef(new Set<string>());
  useEffect(() => { heardOffers.current = new Set(); }, [driver?.id]);
  useEffect(() => {
    if (!isOnline) return;
    const newOffers = freshIncoming.filter(row => !heardOffers.current.has(row.id));
    for (const row of freshIncoming) heardOffers.current.add(row.id);
    if (newOffers.length) playDriverSound();
    if (heardOffers.current.size > 200) heardOffers.current = new Set(freshIncoming.map(row => row.id));
  }, [freshIncoming, isOnline, playDriverSound]);

  const { declinedIds, decline, declineError, isDeclining, declinesReady, declinesLoadError, refreshDeclines } = useDriverDeclines(driver?.id, freshIncoming.map(r => r.id));
  const incomingRequests = declinesReady === false ? [] : freshIncoming.filter((r) => !declinedIds.has(r.id));
  const refusalError = declineError || declinesLoadError;
  const refusalMessage = refusalError ? refusalError instanceof Error ? refusalError.message : t('request_missed') : '';

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
      if (user?.id) {
        await queryClient.cancelQueries({ queryKey: queryKeys.driverRecord(user.id) });
        queryClient.setQueryData(queryKeys.driverRecord(user.id), confirmed);
      }
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

  const toggleAvailability = () => {
    if (toggleInFlight.current || !driver || !user?.id) return;
    const target = !driver.is_online;
    toggleInFlight.current = true;
    void queryClient.cancelQueries({ queryKey: queryKeys.driverRecord(user.id) }).then(() => toggleMutation.mutate(target));
  };

  // ── Accept request ──
  const acceptMutation = useMutation({
    retry: false,
    onMutate: () => ({ owner: user?.id }),
    mutationFn: async (requestId: string) => {
      if (!driver) throw new Error('No driver record');
      const request = incomingRequests.find(row => row.id === requestId);
      if (!request || !isOpenRequest(request)) throw new Error('Заявката вече не е налична. Списъкът се обновява.');
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
      setError('');
      if (driver?.id) {
        cacheDriverRequest(queryClient, driver.id, confirmed);
      }
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.id) });
      }
    },
    onError: (err, _requestId, context) => {
      if (context?.owner !== activeOwner.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (driver?.id) queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      setError(err instanceof Error ? err.message : t('request_missed'));
      if (user?.id) {
        queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.id) });
      }
    },
  });
  const acceptRequest = (id: string) => {
    if (acceptInFlight.current) return;
    const request = incomingRequests.find(row => row.id === id);
    if (!request || !isOpenRequest(request)) { setError('Заявката вече не е налична. Обнови списъка.'); return; }
    acceptInFlight.current = true; acceptMutation.mutate(id);
  };

  // ── Arrived action ──
  const arrivedMutation = useMutation({
    retry: false,
    mutationFn: (request: TaxiRequest) => transitionTaxiRequest(request, 'arrived'),
    onSuccess: (updated) => {
      setError('');
      if (driver?.id) {
        cacheDriverRequest(queryClient, driver.id, updated);
      }
    },
    onError: (err) => {
      if (driver?.id) queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      setError(err instanceof Error ? err.message : t('trip_arrived_error'));
    },
  });

  // ── Start trip action ──
  const startMutation = useMutation({
    retry: false,
    mutationFn: (request: TaxiRequest) => transitionTaxiRequest(request, 'in_progress'),
    onSuccess: (updated) => {
      setError('');
      if (driver?.id) {
        cacheDriverRequest(queryClient, driver.id, updated);
      }
    },
    onError: (err) => {
      if (driver?.id) queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
      setError(err instanceof Error ? err.message : t('trip_start_error'));
    },
  });

  const endMutation=useMutation({retry:false,
    mutationFn:(request:TaxiRequest)=>endRideTrip(request.id,driver!.id),
    onSuccess:updated=>{
      if(driver?.id)cacheDriverRequest(queryClient,driver.id,updated);
      setError('');setCheckoutOwner(user?.id??'');setCheckoutRequest(updated);
    },
    onError:cause=>{setError(cause instanceof Error?cause.message:'Краят не е потвърден. Обнови курса и опитай пак.');
      if(driver?.id)void queryClient.invalidateQueries({queryKey:queryKeys.driverActiveRequest(driver.id)});},
  });

  // ── Realtime: taxi_requests ──
  useEffect(() => {
    if (!user?.id || !driver?.id) return;
    setRequestsRealtime(false);
    let subscribed = false;

    const channel = supabase
      .channel('driver-requests-panel-' + driver.id)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'taxi_requests', filter: `driver_id=eq.${driver.id}` },
        (payload) => {
          const newRow = payload.new as TaxiRequest;
          if (['accepted', 'arrived', 'in_progress'].includes(newRow.status)) {
            cacheDriverRequest(queryClient, driver.id, newRow);
            queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.id) });
          } else if (['completed', 'cancelled'].includes(newRow.status)) {
            if(newRow.payment_status==='paid'&&newRow.payment_method==='online'){setCheckoutRequest(current=>current?.id===newRow.id?null:current);void queryClient.invalidateQueries({queryKey:['accounting']});}
            cacheDriverRequest(queryClient, driver.id, newRow);
          }
        },
      )
      .subscribe(status => {
        setRequestsRealtime(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          if (subscribed) {
            queryClient.invalidateQueries({ queryKey: queryKeys.driverActiveRequest(driver.id) });
            queryClient.invalidateQueries({ queryKey: queryKeys.driverIncomingRequests(user.id) });
          }
          subscribed = true;
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, driver?.id, isOnline, queryClient]);

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
      <PageLoading title="Заявки" backTo="/driver/home" />
    );
  }

  const toggling = toggleMutation.isPending;

  return (
    <div className="min-h-screen bg-background-50">
      {/* ── Header ── */}
      <header className="bg-white px-4 py-3 flex flex-wrap items-center gap-3 sticky top-0 z-50 border-b border-background-100">
        <BackButton to="/driver/home" />
        <h1 className="text-base font-bold text-foreground-950 font-heading">{t('nav_requests')}</h1>
        {!isOnline && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-foreground-400 bg-background-100 px-3 py-1.5 rounded-full">
            <i className="ri-wifi-off-line text-xs" />
            {t('you_are_offline')}
          </span>
        )}
        {isOnline && (
          <span className={`ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full ${gps.status === 'tracking' ? 'text-accent-600 bg-accent-50' : 'text-amber-800 bg-amber-50'}`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${gps.status === 'tracking' ? 'bg-accent-500' : 'bg-amber-500'}`} />
            {gps.status === 'tracking' ? t('you_are_online') : gps.status === 'acquiring' ? 'Уточняваме GPS' : 'Изчаква GPS'}
          </span>
        )}
        <DriverWallet owner={user?.id} driverId={driver?.id} receipt={paidReceipt} />
      </header>

      <div className="p-4 max-w-lg mx-auto">
        {identity.data?.company && <p className="text-sm text-foreground-700 mb-3"><strong>Фирма: {identity.data.company}</strong>{identity.data.category && <> · Категория: {identity.data.category}</>}</p>}
        {activeRequest && !isOnline && <p className="text-sm text-foreground-600 mb-3">{t('gps_active_ride_offline')}</p>}
        {(isOnline || activeRequest) && gps.status !== 'tracking' && !gps.error && <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-xl p-3 mb-3">{gps.message || 'Изчакваме актуална GPS позиция.'}</p>}
        {activeRequest && gps.status !== 'tracking' && <div className="mb-3 text-sm">
          {gpsError && <p role="alert" className="text-red-600 mb-2">{gpsError}</p>}
          <button type="button" className="text-primary-700 underline" disabled={gps.retrying} onClick={gps.retryLocation}>{gps.retrying ? 'Обновяване на GPS…' : 'Обнови GPS'}</button>
        </div>}

        {/* ── Error ── */}
        {(error || refusalMessage) && (
          <div className="mb-3 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
            <i className="ri-error-warning-line" />
            {error || refusalMessage}
            {declinesLoadError && <button className="underline" onClick={() => void refreshDeclines()}>Обнови заявките</button>}
            {error && <button type="button" aria-label="Затвори съобщението" onClick={() => setError('')} className="ml-auto w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-red-100"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
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
              onClick={toggleAvailability}
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
            {driver && !driver.is_verified && <p className="text-xs text-foreground-600 my-3">Премини подготовката и качи документите преди верификация от фирмата. <button type="button" className="underline text-primary-700" onClick={() => navigate('/driver/profile')}>Към подготовката и документите</button> · <button type="button" className="underline" onClick={() => void driverQuery.refetch()}>Обнови статуса</button></p>}
              {isOnline && gps.status !== 'tracking' && <button type="button" className="text-sm text-primary-700 underline mb-2" disabled={gps.retrying} onClick={gps.retryLocation}>{gps.retrying ? 'Обновяване на GPS…' : 'Обнови GPS'}</button>}
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
            {!activeRequest.trip_ended_at && navTarget && navTarget.lat != null && navTarget.lng != null && (
              <div
                className="mb-4 rounded-xl overflow-hidden border border-background-100"
                style={{ height: '360px' }}
              >
                <DriverRouteMap
                  key={activeRequest.id}
                  requestId={activeRequest.id}
                  targetLat={navTarget.lat}
                  targetLng={navTarget.lng}
                  pickup={{ lat: activeRequest.pickup_latitude, lng: activeRequest.pickup_longitude }}
                  destination={activeRequest.destination_latitude != null && activeRequest.destination_longitude != null
                    ? { lat: activeRequest.destination_latitude, lng: activeRequest.destination_longitude } : undefined}
                  targetKind={activeRequest.status === 'accepted' || activeRequest.status === 'arrived' ? 'pickup' : 'destination'}
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
                    disabled={endMutation.isPending}
                    onClick={() => {if(activeRequest.trip_ended_at){setCheckoutOwner(user?.id??'');setCheckoutRequest(activeRequest);}else if(!endMutation.isPending)endMutation.mutate(activeRequest);}}
                    className="w-full py-3.5 rounded-xl bg-foreground-950 text-white text-sm font-semibold hover:bg-foreground-800 transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    <i className="ri-flag-line" />
                    {endMutation.isPending?'Записване на края…':activeRequest.trip_ended_at?'Плащане по курса':t('end_trip')}
                  </button>
                  {activeRequest.trip_ended_at&&<p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Пътуването приключи · Очаква плащане. Клиентът може да плати от телефона си или в брой.</p>}
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

        {!activeRequest&&!paidReceipt&&manualNotice?.owner===user?.id&&manualNotice?.driverId===driver?.id&&<p role="status" className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Курсът е приключен. Получената сума или проблемът с плащането са записани в отчета.</p>}
        {user?.id && driver?.id && <Suspense fallback={checkoutRequest ? <p role="status">Зареждане на плащането…</p> : null}><RideCheckout key={`${user.id}:${driver.id}`} owner={user.id} driverId={driver.id} request={checkoutOwner === user.id ? checkoutRequest : null} onClose={() => { setCheckoutRequest(null); void queryClient.invalidateQueries({queryKey:queryKeys.driverActiveRequest(driver.id)}); }} onFinished={ride => {
          if (activeOwner.current !== user.id) return;
          cacheDriverRequest(queryClient, driver.id, ride); setCheckoutRequest(null); setError('');
          setManualNotice({owner:user.id,driverId:driver.id});
          void queryClient.invalidateQueries({ queryKey: ['accounting'] });
        }} /></Suspense>}

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
                    onClick={toggleAvailability}
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
                            onClick={() => acceptRequest(req.id)}
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

