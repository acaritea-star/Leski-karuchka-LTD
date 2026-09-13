import type { Tables } from '@/lib/database.types';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import NotificationBell from '@/components/feature/NotificationBell';
import EnableNotificationsBanner from '@/components/feature/EnableNotificationsBanner';
import DriverTracking from '@/pages/customer/components/DriverTracking';
import LocationPicker from '@/pages/customer/components/LocationPicker';
import AppMenu from '@/pages/customer/components/AppMenu';
import BookingCard from '@/pages/customer/components/BookingCard';
import RequestStatusCard from '@/pages/customer/components/RequestStatusCard';
import BookingMap from '@/pages/customer/components/BookingMap';
import WelcomeOnboarding from '@/pages/customer/components/WelcomeOnboarding';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { broadcastPushToDrivers } from '@/lib/push';
import {
  calculateDistance,
  estimateDuration,
  type LocationPreset,
} from '@/lib/geo';
import { computeRoute, reverseGeocode, type RouteResult } from '@/lib/googleMaps';
import {
  DEFAULT_PRICING,
  pricingFromRow,
  applyVehicleMultiplier,
  calculateFare,
  type PricingConfig,
  type FareBreakdown,
} from '@/lib/pricing';
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

type SelectingField = 'pickup' | 'dest' | null;
type RequestStatus = 'idle' | 'creating' | 'created' | 'error';
type PaymentMethod = 'cash' | 'card' | 'online';

const TRACKING_STATUSES: Tables<'taxi_requests'>['status'][] = ['accepted', 'arrived', 'in_progress'];

const RECENT_KEY = 'leski_recent_locations';
const LOCATION_PERMISSION_KEY = 'leski_location_permission';
const MAX_RECENT = 5;

function loadRecent(): LocationPreset[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as LocationPreset[]) : [];
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
  const [selectingField, setSelectingField] = useState<SelectingField>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFareDetails, setShowFareDetails] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [showPermission, setShowPermission] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try {
      return localStorage.getItem('leski_onboarded') !== 'true';
    } catch {
      return true;
    }
  });
  const [recent, setRecent] = useState<LocationPreset[]>(() => loadRecent());

  // Request state
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('idle');
  const [activeRequest, setActiveRequest] = useState<ActiveRequest | null>(null);
  const [requestError, setRequestError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Booking options
  const paymentMethod = 'cash';
  const [vehicleType, setVehicleType] = useState('');
  const [vehicleTypes, setVehicleTypes] = useState<Tables<'vehicle_types'>[]>([]);
  const [quoteRefresh, setQuoteRefresh] = useState(0);
  const bookingId = useRef(crypto.randomUUID());
  const bookingInFlight = useRef(false);

  // Real driving route (distance + duration from Google Routes, when available)
  const [route, setRoute] = useState<RouteResult | null>(null);

  const activeRequestId = activeRequest?.id;

  useEffect(() => {
    if (!route?.quote_expires_at) return;
    const timer = setTimeout(() => setRoute(current => current ? {...current,quote_id:undefined} : null), Math.max(0,Date.parse(route.quote_expires_at)-Date.now()));
    return () => clearTimeout(timer);
  },[route?.quote_expires_at]);

  // Realtime subscription ref
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const autoLocatedRef = useRef(false);

  // Register for push notifications
  useEffect(() => {
    if (user?.id) {
      registerPush(user.id);
    }
  }, [user?.id, registerPush]);

  const fare = route?.breakdown ?? null;
  const price = activeRequest?.estimated_price ?? fare?.total ?? null;
  const priceIsEstimate = !route?.quote_id;
  const canRequest = !!route?.quote_id && !!route.quote_expires_at && Date.parse(route.quote_expires_at) > Date.now()
    && !!pickup && !!destination && requestStatus !== 'creating' && !activeRequest;

  const isTracking =
    !!activeRequest &&
    !!activeRequest.driver_id &&
    TRACKING_STATUSES.includes(activeRequest.status);

  const firstName = (user?.first_name || user?.email?.split('@')[0] || '').trim();

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
      if (selectingField === 'pickup') {
        setPickup(loc);
        setSelectingField('dest');
      } else if (selectingField === 'dest') {
        setDestination(loc);
        setSelectingField(null);
      }
      setSearchQuery('');
    },
    [selectingField, addRecent],
  );

  // Detect user's current location via GPS
  const detectLocation = useCallback(
    (target: 'pickup' | 'dest' | 'auto') => {
      if (!('geolocation' in navigator)) {
        setLocationError(t('location_denied'));
        localStorage.setItem(LOCATION_PERMISSION_KEY, 'denied');
        return;
      }
      setLocating(true);
      setLocationError('');
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          localStorage.setItem(LOCATION_PERMISSION_KEY, 'granted');
          const { latitude, longitude } = pos.coords;
          // Resolve a precise street address from the GPS fix; fall back to the
          // generic label only if reverse geocoding is unavailable.
          let address = t('current_location');
          const geo = await reverseGeocode(latitude, longitude);
          if (geo?.formatted_address) {
            address = geo.formatted_address;
          }
          const loc: Location = { address, lat: latitude, lng: longitude };
          if (target === 'dest') {
            setDestination(loc);
            setSelectingField(null);
          } else {
            setPickup(loc);
            setSelectingField('dest');
          }
          setSearchQuery('');
          setLocating(false);
        },
        () => {
          localStorage.setItem(LOCATION_PERMISSION_KEY, 'denied');
          setLocating(false);
          setLocationError(t('location_denied'));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
      );
    },
    [t],
  );

  // Handle field click
  const handleFieldClick = (field: SelectingField) => {
    if (activeRequest) return;
    setSelectingField(selectingField === field ? null : field);
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
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Заявката не е потвърдена. Опитай отново.');
      setActiveRequest(data as ActiveRequest); setRequestStatus('created');
      void broadcastPushToDrivers(data.company_id, t('push_new_request_title'),
        t('push_new_request_body', {pickup:pickup?.address,dest:destination?.address}),
        {tag:`request-${data.id}`,data:{request_id:data.id}});
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : t('request_failed'));
      setRequestStatus('error');
    } finally { bookingInFlight.current = false; }
  };

  // Recover any active request on mount
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('taxi_requests')
      .select('*')
      .eq('customer_id', user.id)
      .in('status', ['pending', ...TRACKING_STATUSES])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setActiveRequest(data as ActiveRequest);
          setRequestStatus('created');
        }
      });
  }, [user?.id]);

  // First-open location permission flow (waits for onboarding to finish)
  useEffect(() => {
    if (showOnboarding) return;
    if (autoLocatedRef.current) return;
    if (activeRequest || pickup) return;
    autoLocatedRef.current = true;
    const perm = localStorage.getItem(LOCATION_PERMISSION_KEY);
    if (perm === 'granted') {
      detectLocation('auto');
    } else if (perm !== 'denied') {
      setShowPermission(true);
    }
  }, [showOnboarding, activeRequest, pickup, detectLocation]);

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
    setRoute(null); setRequestError('');
    bookingId.current = crypto.randomUUID();
    const timer = setTimeout(() => {
      computeRoute(pickup, destination, {quote:{vehicle_type_id:vehicleType,pickup_address:pickup.address,destination_address:destination.address}})
        .then(result => {
          if (!active) return;
          setRoute(result);
          if (!result?.quote_id) setRequestError('Не успяхме да потвърдим маршрут и цена. Натисни „Обнови цената“.');
        });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, destination, vehicleType, quoteRefresh, activeRequestId]);

  const cancelRequest = async () => {
    if (!activeRequest) return;
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
    } catch (err: unknown) {
      setConfirmCancel(false);
      setRequestError(err instanceof Error ? err.message : t('request_failed'));
    }
  };

  // Reset
  const resetRequest = () => {
    setActiveRequest(null);
    setRequestStatus('idle');
    setRequestError('');
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

  // Permission sheet actions
  const allowLocation = () => {
    setShowPermission(false);
    detectLocation('auto');
  };

  const chooseManually = () => {
    localStorage.setItem(LOCATION_PERMISSION_KEY, 'denied');
    setShowPermission(false);
    setSelectingField('pickup');
  };

  const completeOnboarding = useCallback(() => {
    localStorage.setItem('leski_onboarded', 'true');
    setShowOnboarding(false);
  }, []);

  // Fetch company pricing config
  useEffect(() => {
    let active = true;
    const load = async () => {
      let companies = supabase.from('companies').select('id').eq('is_active',true).order('created_at').order('id').limit(1);
      if (user?.company_id) companies = companies.eq('id',user.company_id);
      const {data:company,error:companyError} = await companies.maybeSingle();
      if (companyError || !company) { if(active) setRequestError('Няма активна компания.'); return; }
      const {data,error} = await supabase.from('vehicle_types').select('*').eq('company_id',company.id).eq('is_active',true).order('multiplier').order('id');
      if (!active) return;
      if(error || !data?.length) { setRequestError('Няма налични типове автомобили.'); return; }
      setVehicleTypes(data); setVehicleType(current => data.some(v=>v.id===current)?current:data[0].id);
    };
    void load();
    return () => {active=false;};
  }, [user?.company_id]);

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-foreground-500">{t('loading')}</span>
        </div>
      </div>
    );
  }

  // Live driver tracking view during an active trip
  if (isTracking && activeRequest && activeRequest.driver_id) {
    return (
      <DriverTracking
        request={{
          id: activeRequest.id,
          driver_id: activeRequest.driver_id,
          status: activeRequest.status,
          pickup_latitude: activeRequest.pickup_latitude,
          pickup_longitude: activeRequest.pickup_longitude,
          pickup_address: activeRequest.pickup_address,
          destination_latitude: activeRequest.destination_latitude,
          destination_longitude: activeRequest.destination_longitude,
          destination_address: activeRequest.destination_address,
        }}
        onCancel={resetRequest}
      />
    );
  }

  return (
    <div className="relative h-[100dvh] bg-background-50 overflow-hidden lg:flex">
      {/* ===== MAP BACKGROUND ===== */}
      <div className="absolute inset-0 z-0 h-[100dvh] lg:inset-auto lg:relative lg:h-full lg:flex-1 lg:min-w-0">
        <BookingMap
          pickup={pickup}
          destination={destination}
        />
        <div className="absolute inset-0 z-[5] bg-gradient-to-b from-background-50/30 via-background-50/10 to-background-50 pointer-events-none" />
        {pickup && (
          <div className="absolute top-[70px] left-3 z-10 bg-white/95 backdrop-blur rounded-full pl-2.5 pr-3 py-1.5 flex items-center gap-1.5 border border-background-100 shadow-sm max-w-[70%] lg:top-4 lg:left-4">
            <i className="ri-map-pin-2-fill text-primary-500 text-xs" />
            <span className="text-[11px] font-medium text-foreground-700 truncate">
              {pickup.address}
            </span>
          </div>
        )}
      </div>

      {/* ===== CONTENT ===== */}
      <div className="relative z-10 flex flex-col h-[100dvh] overflow-hidden lg:h-full lg:w-[420px] lg:shrink-0 lg:bg-background-50 lg:border-l lg:border-background-100 lg:overflow-y-auto">
        {/* Header */}
        <header className="px-4 pt-3 pb-1 flex items-center justify-between lg:px-5 lg:pt-4">
          <div className="flex items-center gap-2.5">
            <img
              src={LOGO_URL}
              alt={t('app_name')}
              className="h-7 w-auto rounded-md bg-white shadow-sm"
            />
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground-950 font-heading leading-tight tracking-tight">
                {t('app_name')}
              </span>
              <span className="text-[10px] font-semibold text-primary-700 leading-none">
                {t('service_area_label')}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <AppMenu />
          </div>
        </header>

        {/* Greeting */}
        <div className="px-4 pt-2 pb-1 rise-in lg:px-5 lg:pt-3">
          <h1 className="text-2xl font-bold text-foreground-950 font-heading leading-tight">
            {t('greeting_hello')}, <span className="text-primary-600">{firstName}</span>
          </h1>
          <p className="text-sm text-foreground-600 mt-0.5">
            {t('where_to_subtitle')}
          </p>
        </div>

        {/* Enable push notifications (iOS requires a user tap) */}
        <EnableNotificationsBanner />

        {/* Spacer (mobile only — pushes panel to bottom over the map) */}
        <div className="flex-1 min-h-0 lg:hidden" />

        {/* Bottom panel */}
        <div className="px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:px-6 lg:px-4 lg:pb-6 lg:pt-2">
          <div className="mx-auto w-full max-w-md rise-in lg:max-w-none" style={{ animationDelay: '120ms' }}>
            {activeRequest && activeRequest.status ? (
              <RequestStatusCard
                request={activeRequest}
                price={price}
                confirmCancel={confirmCancel}
                onShowCancel={() => setConfirmCancel(true)}
                onKeepRequest={() => setConfirmCancel(false)}
                onCancel={cancelRequest}
                onReset={resetRequest}
                onShare={shareTrip}
                onNewOrder={resetRequest}
                requestError={requestError}
              />
            ) : (
              <>
              <BookingCard
                pickup={pickup}
                destination={destination}
                selectingField={selectingField}
                onFieldClick={handleFieldClick}
                onClearPickup={() => setPickup(null)}
                onClearDestination={() => setDestination(null)}
                onSwap={swapLocations}
                vehicleType={vehicleType}
                onVehicleTypeChange={setVehicleType}
                vehicleOptions={vehicleTypes.map(v=>({id:v.id,label:v.name,icon:v.capacity>4?'ri-bus-line':'ri-car-line'}))}
                paymentMethod={paymentMethod}
                onPaymentMethodChange={() => {}}
                fare={fare}
                priceIsEstimate={priceIsEstimate}
                showFareDetails={showFareDetails}
                onToggleFareDetails={() => setShowFareDetails(!showFareDetails)}
                canRequest={canRequest}
                creating={requestStatus === 'creating'}
                onRequest={createRequest}
                requestError={requestError}
              />
              {pickup && destination && <button type="button" className="w-full py-3 text-sm underline" disabled={requestStatus === 'creating'} onClick={() => setQuoteRefresh(n=>n+1)}>Обнови цената</button>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Location Picker Sheet */}
      {selectingField && !activeRequest && (
        <div className="fixed inset-0 z-[60] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSelectingField(null)} />
          <div className="relative mx-auto max-w-md w-full px-3 pb-4 pt-2 animate-in slide-in-from-bottom-6 fade-in duration-300">
            <div className="w-10 h-1 rounded-full bg-white/80 mx-auto mb-2" />
            <div className="max-h-[65vh] overflow-y-auto rounded-2xl">
              <LocationPicker
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                locating={locating}
                locationError={locationError}
                recent={recent}
                onUseCurrent={() => detectLocation(selectingField || 'pickup')}
                onSelect={selectLocation}
              />
            </div>
          </div>
        </div>
      )}

      {/* Location Permission Sheet */}
      {showPermission && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={chooseManually} />
          <div className="relative bg-white rounded-t-3xl w-full max-w-md p-6 pb-8 animate-in slide-in-from-bottom-6 fade-in duration-300">
            <div className="w-10 h-1 rounded-full bg-background-200 mx-auto mb-5" />
            <div className="w-14 h-14 rounded-2xl bg-accent-100 flex items-center justify-center mx-auto mb-4">
              <i className="ri-map-pin-range-line text-2xl text-accent-600" />
            </div>
            <h2 className="text-xl font-bold text-foreground-950 font-heading text-center mb-2">
              {t('allow_location_title')}
            </h2>
            <p className="text-sm text-foreground-500 text-center mb-6">
              {t('allow_location_desc')}
            </p>
            <button
              onClick={allowLocation}
              className="w-full py-3.5 bg-primary-500 text-white font-semibold rounded-xl hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer mb-2"
            >
              {t('allow_location_btn')}
            </button>
            <button
              onClick={chooseManually}
              className="w-full py-3.5 bg-background-100 text-foreground-600 font-medium rounded-xl hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
            >
              {t('choose_manually')}
            </button>
          </div>
        </div>
      )}

      {/* First-run welcome onboarding */}
      {showOnboarding && (
        <WelcomeOnboarding firstName={firstName} onClose={completeOnboarding} />
      )}
    </div>
  );
}