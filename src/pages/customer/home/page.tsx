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
  const autoLocatedRef = useRef(false);

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

  // Quick-pick a recent address directly from the bottom sheet (no field selected)
  const selectRecentQuick = useCallback(
    (preset: LocationPreset) => {
      addRecent(preset);
      const loc: Location = { address: preset.address, lat: preset.lat, lng: preset.lng };
      if (!pickup) {
        setPickup(loc);
      } else if (!destination) {
        setDestination(loc);
      }
    },
    [addRecent, pickup, destination],
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
          if (!result) {
            setRoute(null);
            setRequestError(t('route_failed'));
          } else {
            setRoute(result);
            setRequestError('');
          }
        });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [pickup, destination, vehicleType, quoteRefresh, activeRequestId, t]);

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
    } catch {
      setConfirmCancel(false);
      setRequestError(t('request_failed_hint'));
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
  }, [user?.company_id, t]);

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
      <div className="absolute inset-0 z-0 lg:relative lg:flex-1 lg:min-w-0">
        <BookingMap pickup={pickup} destination={destination} />
      </div>

      {/* ===== COMPACT FLOATING HEADER ===== */}
      <header
        className="absolute top-0 left-0 right-0 z-20 bg-white border-b border-background-100 lg:right-[420px]"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="h-14 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <img src={LOGO_URL} alt={t('app_name')} className="h-8 w-8 rounded-lg object-cover" />
            <span className="text-[15px] font-bold text-foreground-950 font-heading leading-tight whitespace-nowrap">
              {t('app_name')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <AppMenu />
          </div>
        </div>
      </header>

      {/* ===== OFFLINE BANNER ===== */}
      {offline && (
        <div className="absolute top-20 left-4 right-4 z-30 lg:right-[436px] flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5">
          <i className="ri-wifi-off-line text-red-500 text-lg" />
          <p className="text-[14px] font-medium text-red-700">{t('offline_message')}</p>
        </div>
      )}

      {/* ===== BOTTOM SHEET ===== */}
      <div className="absolute bottom-0 left-0 right-0 z-20 lg:static lg:w-[420px] lg:shrink-0 lg:h-full lg:flex lg:flex-col lg:bg-white lg:border-l lg:border-background-100">
        <div className="mx-auto w-full max-w-md lg:max-w-none lg:flex-1 lg:flex lg:flex-col">
          <div className="bg-white rounded-t-[16px] lg:rounded-none border-t border-background-100 lg:border-t-0 shadow-[0_-6px_24px_rgba(0,0,0,0.06)] lg:shadow-none max-h-[78vh] overflow-y-auto lg:max-h-none lg:flex-1 lg:h-full">
            <div className="sticky top-0 z-10 flex justify-center pt-2.5 pb-1.5 bg-white lg:hidden">
              <div className="w-10 h-1.5 rounded-full bg-background-200" />
            </div>

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
                <EnableNotificationsBanner />
                <BookingCard
                  pickup={pickup}
                  destination={destination}
                  firstName={firstName}
                  locating={locating}
                  recent={recent}
                  onSelectRecent={selectRecentQuick}
                  onFieldClick={handleFieldClick}
                  onClearPickup={() => setPickup(null)}
                  onClearDestination={() => setDestination(null)}
                  onSwap={swapLocations}
                  onUseMyLocation={() => detectLocation('pickup')}
                  vehicleType={vehicleType}
                  onVehicleTypeChange={setVehicleType}
                  vehicleOptions={vehicleTypes.map((v) => ({
                    id: v.id,
                    name: v.name,
                    capacity: v.capacity,
                    available: v.is_active,
                  }))}
                  fare={fare}
                  priceIsEstimate={priceIsEstimate}
                  onRefreshPrice={() => setQuoteRefresh((n) => n + 1)}
                  canRequest={canRequest}
                  creating={requestStatus === 'creating'}
                  onRequest={createRequest}
                  requestError={requestError}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== FULL-SCREEN LOCATION PICKER ===== */}
      {selectingField && !activeRequest && (
        <div className="fixed inset-0 z-[60] bg-white flex flex-col">
          <div
            className="flex items-center gap-1 px-2 border-b border-background-100"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            <button
              type="button"
              onClick={() => setSelectingField(null)}
              aria-label={t('back')}
              className="w-11 h-12 flex items-center justify-center cursor-pointer"
            >
              <i className="ri-arrow-left-line text-2xl text-foreground-700" />
            </button>
            <h2 className="text-[18px] font-bold text-foreground-950 font-heading">
              {selectingField === 'pickup' ? t('pickup_search_title') : t('dest_search_title')}
            </h2>
          </div>
          <div className="flex-1 min-h-0">
            <LocationPicker
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              locating={locating}
              locationError={locationError}
              recent={recent}
              onUseCurrent={() => detectLocation(selectingField || 'pickup')}
              onSelect={selectLocation}
              showCurrentLocation={selectingField === 'pickup'}
            />
          </div>
        </div>
      )}

      {/* Location Permission Sheet */}
      {showPermission && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={chooseManually} />
          <div className="relative bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom-6 fade-in duration-300">
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