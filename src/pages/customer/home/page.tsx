import type { Tables } from '@/lib/database.types';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/feature/NotificationBell';
import DriverTracking from '@/pages/customer/components/DriverTracking';
import LocationPicker from '@/pages/customer/components/LocationPicker';
import AppMenu from '@/pages/customer/components/AppMenu';
import BookingCard from '@/pages/customer/components/BookingCard';
import RequestStatusCard from '@/pages/customer/components/RequestStatusCard';
import BookingMap from '@/pages/customer/components/BookingMap';
import CustomerLayout, { BookingSkeleton } from '@/pages/customer/components/CustomerLayout';
import BookingSteps from '@/pages/customer/components/BookingSteps';
import { recentLocations, stepAfterSelection, type BookingStep } from '@/pages/customer/components/bookingFlow';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { broadcastPushToDrivers } from '@/lib/push';
import type { LocationPreset } from '@/lib/geo';
import { computeRoute, reverseGeocode, type RouteResult } from '@/lib/googleMaps';
import { LOGO_URL } from '@/lib/logo';

// Types
interface Location {
  address: string;
  lat: number;
  lng: number;
}

interface ActiveRequest {
  id: string;
  company_id: string;
  driver_id: string | null;
  status: Tables<'taxi_requests'>['status'];
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string;
  destination_latitude: number;
  destination_longitude: number;
  destination_address: string;
  estimated_price: number | null;
  cancelled_by?: string | null;
}

type RequestStatus = 'idle' | 'creating' | 'created' | 'error';

const TRACKING_STATUSES: Tables<'taxi_requests'>['status'][] = ['accepted', 'arrived', 'in_progress'];

const RECENT_KEY = 'leski_recent_locations';
const MAX_RECENT = 5;

function loadRecent(): LocationPreset[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? recentLocations(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function persistRecent(list: LocationPreset[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export default function CustomerHome() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { register: registerPush } = usePushNotifications();

  // Location state
  const [pickup, setPickup] = useState<Location | null>(null);
  const [destination, setDestination] = useState<Location | null>(null);
  const [step, setStep] = useState<BookingStep>('pickup');
  const [searchQuery, setSearchQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [recent, setRecent] = useState<LocationPreset[]>(() => loadRecent());

  // Request state
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('idle');
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [requestError, setRequestError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [recovering, setRecovering] = useState(true);
  const [recoveryError, setRecoveryError] = useState(false);
  const [recoveryAttempt, setRecoveryAttempt] = useState(0);

  // Booking options
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleTypes, setVehicleTypes] = useState<Tables<'vehicle_types'>[]>([]);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const [configAttempt, setConfigAttempt] = useState(0);
  const bookingId = useRef(crypto.randomUUID());
  const bookingInFlight = useRef(false);

  // Real driving route (distance + duration from Google Routes, when available)
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeInput, setRouteInput] = useState('');
  const [calculating, setCalculating] = useState(false);
  const quoteInput = JSON.stringify([pickup, destination, vehicleType]);
  const currentRoute = routeInput === quoteInput ? route : null;
  const gpsRevision = useRef(0);

  // Network connectivity state
  const [offline, setOffline] = useState<boolean>(
    typeof navigator !== 'undefined' ? !navigator.onLine : false,
  );

  const activeRequestId = activeRequest?.id;

  useEffect(() => {
    if (!route?.quote_expires_at) return;
    const timer = setTimeout(() => setRoute(current => current ? {...current,quote_id:undefined} : null), Math.max(0,Date.parse(route.quote_expires_at)-Date.now()));
    return () => clearTimeout(timer);
  },[route?.quote_expires_at]);

  // Realtime subscription ref
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  useEffect(() => () => { ++gpsRevision.current; }, []);

  // Register for push notifications
  useEffect(() => {
    if (user?.id) {
      registerPush(user.id);
    }
  }, [user?.id, registerPush]);

  // Track online/offline connectivity
  useEffect(() => {
    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const fare = currentRoute?.breakdown ?? null;
  const price = activeRequest?.estimated_price ?? fare?.total ?? null;
  const canRequest = !!currentRoute?.quote_id && !!currentRoute.quote_expires_at && Date.parse(currentRoute.quote_expires_at) > Date.now()
    && !!fare && Number.isFinite(fare.total) && fare.total >= 0
    && !!pickup && !!destination && requestStatus !== 'creating' && !activeRequest && !recovering && !recoveryError && !offline;

  const isTracking =
    !!activeRequest &&
    !!activeRequest.driver_id &&
    TRACKING_STATUSES.includes(activeRequest.status);

  // Save a recently used location
  const addRecent = useCallback((preset: LocationPreset) => {
    setRecent((prev) => {
      const next = [preset, ...prev.filter((p) => p.address !== preset.address)].slice(0, MAX_RECENT);
      persistRecent(next);
      return next;
    });
  }, []);

  // Select a location from the picker
  const selectLocation = useCallback(
    (preset: LocationPreset) => {
      addRecent(preset);
      const loc: Location = { address: preset.address, lat: preset.lat, lng: preset.lng };
      ++gpsRevision.current;
      setLocating(false);
      setLocationError('');
      if (step === 'pickup') {
        setPickup(loc);
        setStep(stepAfterSelection('pickup', !!destination));
      } else if (step === 'dest') {
        setDestination(loc);
        setStep(stepAfterSelection('dest', !!pickup));
      }
      setSearchQuery('');
    },
    [step, pickup, destination, addRecent],
  );

  // Detect user's current location via GPS
  const detectLocation = useCallback(
    () => {
      if (!('geolocation' in navigator)) {
        setLocationError(t('location_denied'));
        return;
      }
      setLocating(true);
      setLocationError('');
      const revision = ++gpsRevision.current;
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          // Resolve a precise street address from the GPS fix; fall back to the
          // generic label only if reverse geocoding is unavailable.
          let address = t('current_location');
          const geo = await reverseGeocode(latitude, longitude);
          if (gpsRevision.current !== revision) return;
          if (geo?.formatted_address) {
            address = geo.formatted_address;
          }
          const loc: Location = { address, lat: latitude, lng: longitude };
          setPickup(loc);
          setStep(stepAfterSelection('pickup', !!destination));
          setSearchQuery('');
          setLocating(false);
        },
        () => {
          if (gpsRevision.current !== revision) return;
          setLocating(false);
          setLocationError(t('location_denied'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
      );
    },
    [t, destination],
  );

  // Handle field click
  const handleFieldClick = (field: BookingStep) => {
    if (activeRequest || bookingInFlight.current || (field === 'confirm' && (!pickup || !destination))) return;
    ++gpsRevision.current;
    setLocating(false);
    setLocationError('');
    setStep(field);
    setSearchQuery('');
    setRequestError('');
  };

  // Swap pickup and destination
  const swapLocations = () => {
    setPickup(destination);
    setDestination(pickup);
  };

  // Create taxi request
  const createRequest = async () => {
    if (!user || !route?.quote_id || !canRequest || bookingInFlight.current) return;
    bookingInFlight.current = true;
    setRequestStatus('creating'); setRequestError('');
    try {
      const {data, error} = await supabase.rpc('create_taxi_request', {
        p_quote_id: route.quote_id, p_request_id: bookingId.current, p_payment_method: 'cash',
      });
      if (error) throw new Error();
      if (!data) throw new Error();
      setActiveRequest(data as ActiveRequest); setRequestStatus('created');
      void broadcastPushToDrivers(data.company_id, t('push_new_request_title'),
        t('push_new_request_body', {pickup:pickup?.address,dest:destination?.address}),
        {tag:`request-${data.id}`,data:{request_id:data.id}});
    } catch {
      setRequestError(t('request_failed_hint'));
      setRequestStatus('error');
    } finally { bookingInFlight.current = false; }
  };

  // Recover any active request on mount
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setRecovering(true);
    setRecoveryError(false);
    const recover = async () => {
      try {
        const { data, error } = await supabase.from('taxi_requests').select('*')
          .eq('customer_id', user.id).in('status', ['pending', ...TRACKING_STATUSES])
          .order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!active) return;
        if (error) throw error;
        if (data) {
          setActiveRequest(data as ActiveRequest);
          setRequestStatus('created');
        }
      } catch { if (active) setRecoveryError(true); }
      finally { if (active) setRecovering(false); }
    };
    void recover();
    return () => { active = false; };
  }, [user?.id, recoveryAttempt]);

  // Polling fallback
  useEffect(() => {
    if (!activeRequestId) return;
    const requestId = activeRequestId;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('taxi_requests')
          .select('*')
          .eq('id', requestId)
          .maybeSingle();
        if (data) {
          setActiveRequest((prev) => (prev ? { ...prev, ...(data as ActiveRequest) } : prev));
        }
      } catch {
        // silently ignore
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [activeRequestId]);

  // Realtime subscription
  useEffect(() => {
    if (!activeRequestId) return;

    const requestId = activeRequestId;
    const channel = supabase
      .channel(`request-${requestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'taxi_requests',
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          setActiveRequest((prev) =>
            prev ? ({ ...prev, ...(payload.new as ActiveRequest) }) : prev,
          );
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeRequestId]);

  // Only a server-created quote can be booked. A failed route never becomes a guessed fare.
  useEffect(() => {
    if (!pickup || !destination || !vehicleType || activeRequestId) return;
    let active = true;
    setRoute(null); setRequestError(''); setCalculating(true);
    bookingId.current = crypto.randomUUID();
    const timer = setTimeout(() => {
      computeRoute(pickup, destination, {quote:{vehicle_type_id:vehicleType,pickup_address:pickup.address,destination_address:destination.address}})
        .then(result => {
          if (!active) return;
          setCalculating(false);
          if (!result?.quote_id || !result.quote_expires_at || !result.breakdown || !Number.isFinite(result.breakdown.total)) {
            setRoute(null);
            setRequestError(t('route_failed'));
          } else {
            setRoute(result);
            setRouteInput(quoteInput);
            setRequestError('');
          }
        });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, destination, vehicleType, quoteRefresh, activeRequestId, quoteInput, t]);

  const cancelRequest = async () => {
    if (!activeRequest || cancelling) return;
    setCancelling(true);
    setRequestError('');
    try {
      const { data, error } = await supabase
        .from('taxi_requests')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: 'customer',
        })
        .eq('id', activeRequestId!)
        .eq('status', 'pending')
        .select('id, status')
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setConfirmCancel(false);
        setActiveRequest((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
      } else {
        setConfirmCancel(false);
        setRequestError(t('request_already_taken'));
      }
    } catch {
      setConfirmCancel(false);
      setRequestError(t('request_failed_hint'));
    } finally { setCancelling(false); }
  };

  // Reset
  const resetRequest = () => {
    setActiveRequest(null);
    setRequestStatus('idle');
    setRequestError('');
    setConfirmCancel(false);
    setStep(pickup && destination ? 'confirm' : 'pickup');
  };

  // Share active trip
  const shareTrip = async () => {
    if (!activeRequest) return;
    const text = `${t('app_name')}: ${activeRequest.pickup_address} \u2192 ${activeRequest.destination_address}`;
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: t('live_tracking'), text });
      } catch {
        /* cancelled */
      }
    }
  };

  // Fetch company pricing config
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const load = async () => {
      let companies = supabase.from('companies').select('id').eq('is_active',true).order('created_at').order('id').limit(1);
      if (user?.company_id) companies = companies.eq('id',user.company_id);
      const {data:company,error:companyError} = await companies.maybeSingle();
      if (companyError || !company) { if(active) setRequestError('Няма активна компания.'); return; }
      const {data,error} = await supabase.from('vehicle_types').select('*').eq('company_id',company.id).order('multiplier').order('id');
      if (!active) return;
      if(error || !data?.length) { setRequestError(t('no_vehicles_available')); return; }
      setVehicleTypes(data);
      const firstAvailable = data.find(v => v.is_active);
      setVehicleType(current => {
        const cur = data.find(v => v.id === current);
        if (cur && cur.is_active) return current;
        return firstAvailable ? firstAvailable.id : '';
      });
    };
    void load();
    return () => {active=false;};
  }, [user?.id, user?.company_id, configAttempt, t]);

  // Redirect to orders after trip completed or cancelled
  useEffect(() => {
    if (activeRequest?.status === 'completed' || activeRequest?.status === 'cancelled') {
      const timer = setTimeout(() => {
        if (activeRequest.status === 'completed' && activeRequest.driver_id) {
          navigate(`/customer/orders?rate=${activeRequest.id}`);
        } else {
          navigate('/customer/orders');
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [activeRequest?.status, activeRequest?.id, activeRequest?.driver_id, navigate]);

  // Keep the existing live tracking and booking RPC contracts.
  if (isTracking && activeRequest?.driver_id) {
    return <DriverTracking request={{ ...activeRequest, driver_id: activeRequest.driver_id }} onCancel={resetRequest} />;
  }

  const mapPickup = activeRequest
    ? { address: activeRequest.pickup_address, lat: activeRequest.pickup_latitude, lng: activeRequest.pickup_longitude }
    : pickup;
  const mapDestination = activeRequest
    ? { address: activeRequest.destination_address, lat: activeRequest.destination_latitude, lng: activeRequest.destination_longitude }
    : destination;

  return <CustomerLayout
    map={<BookingMap pickup={mapPickup} destination={mapDestination} route={currentRoute} />}
    header={<>
      <div className="customer-brand">
        <img src={LOGO_URL} alt="" />
        <span>{t('app_name')}<small>{t('booking_tagline')}</small></span>
      </div>
      <div className="customer-header-actions"><NotificationBell /><AppMenu /></div>
    </>}
    notice={offline ? <><i className="ri-wifi-off-line" aria-hidden="true" />{t('offline_message')}</> : undefined}
  >
    {authLoading || recovering ? <BookingSkeleton label={t('booking_restoring')} />
      : recoveryError ? <div className="booking-recovery">
        <i className="ri-cloud-off-line" aria-hidden="true" />
        <p role="alert">{t('booking_recovery_error')}</p>
        <button type="button" className="booking-primary" onClick={() => setRecoveryAttempt(n => n + 1)}>{t('booking_retry')}</button>
      </div>
      : activeRequest ? <RequestStatusCard request={activeRequest} price={price}
        confirmCancel={confirmCancel} cancelling={cancelling}
        onShowCancel={() => setConfirmCancel(true)} onKeepRequest={() => setConfirmCancel(false)}
        onCancel={cancelRequest} onReset={() => navigate('/customer/orders')}
        onShare={shareTrip} onNewOrder={resetRequest} requestError={requestError} />
      : <>
        <BookingSteps step={step} canConfirm={!!pickup && !!destination}
          disabled={requestStatus === 'creating'} onChange={handleFieldClick} />
        {step === 'confirm' && pickup && destination
          ? <BookingCard pickup={pickup} destination={destination}
            onFieldClick={handleFieldClick} onSwap={swapLocations}
            vehicleType={vehicleType} onVehicleTypeChange={setVehicleType}
            vehicleOptions={vehicleTypes.map(v => ({ id: v.id, name: v.name, capacity: v.capacity, available: v.is_active }))}
            fare={fare} distance={currentRoute?.distance_km} duration={currentRoute?.duration_min}
            calculating={calculating} priceExpired={!!fare && !currentRoute?.quote_id}
            onRefreshPrice={() => { setQuoteRefresh(n => n + 1); if (!vehicleType) setConfigAttempt(n => n + 1); }} canRequest={canRequest}
            creating={requestStatus === 'creating'} onRequest={createRequest} requestError={requestError} />
          : <LocationPicker key={step} searchQuery={searchQuery} onSearchChange={setSearchQuery}
            locating={locating} locationError={locationError} recent={recent}
            onUseCurrent={detectLocation} onSelect={selectLocation} showCurrentLocation={step === 'pickup'} />}
      </>}
  </CustomerLayout>;
}
