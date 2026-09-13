import { isFreshTimestamp } from '@/lib/driverLocation';
/* global google */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { calculateDistance, estimateDuration } from '@/lib/geo';
import { computeRoute, decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';

export interface TrackingRequest {
  id: string;
  driver_id: string;
  status: import('@/lib/database.types').Tables<'taxi_requests'>['status'];
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string;
  destination_latitude: number;
  destination_longitude: number;
  destination_address: string;
}

interface DriverInfo {
  name: string;
  phone: string;
  avatar_url: string | null;
  rating: number;
  total_trips: number;
  vehicle_label: string;
}

interface DriverLocation {
  latitude: number;
  longitude: number;
  heading: number | null;
  speed: number | null;
}

const ROUTE_COLOR = '#0ea5a0';
const CAR_COLORS: Record<string, string> = {
  comfort: '#f59e0b',
  van: '#78716c',
  standard: '#0d9488',
};

function playChime() {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    };
    tone(880, 0, 0.4);
    tone(1318.51, 0.2, 0.55);
  } catch {
    /* audio not available */
  }
}

function carSymbol(heading: number, vehicleType: string): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    rotation: heading,
    scale: 5,
    fillColor: CAR_COLORS[vehicleType] || CAR_COLORS.standard,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

function pickupIcon(): google.maps.Icon {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<circle cx="8" cy="8" r="7" fill="#0ea5a0" stroke="#ffffff" stroke-width="2.5"/></svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(16, 16),
    anchor: new google.maps.Point(8, 8),
  };
}

function destIcon(): google.maps.Icon {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">' +
    '<rect x="3" y="3" width="10" height="10" fill="#888888" stroke="#ffffff" stroke-width="2" transform="rotate(45 8 8)"/></svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(16, 16),
    anchor: new google.maps.Point(8, 8),
  };
}

export default function DriverTracking({
  request,
  onCancel,
}: {
  request: TrackingRequest;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [driverInfo, setDriverInfo] = useState<DriverInfo | null>(null);
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [liveRoute, setLiveRoute] = useState<{ distance_km: number; duration_min: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError,setCancelError] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [vehicleType, setVehicleType] = useState<string>('standard');
  const [positionStale, setPositionStale] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<number>(0);
  const [mapReady, setMapReady] = useState(false);

  // Google Maps refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const carMarkerRef = useRef<google.maps.Marker | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const liveRoutePolylineRef = useRef<google.maps.Polyline | null>(null);
  const prevPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastRecenterRef = useRef(0);
  const lastRouteFetchRef = useRef({ lat: 0, lng: 0, at: 0 });

  const headingToPickup = request.status === 'accepted' || request.status === 'arrived';
  const isWaiting = request.status === 'arrived';
  const canCancel =
    request.status === 'accepted' || request.status === 'arrived' || request.status === 'in_progress';

  const targetLat = headingToPickup ? request.pickup_latitude : request.destination_latitude;
  const targetLng = headingToPickup ? request.pickup_longitude : request.destination_longitude;

  // ── Initialise Google map (once) ──
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    loadGoogleMaps()
      .then(() => {
        if (cancelled || mapRef.current) return;
        const map = new google.maps.Map(el, {
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          zoomControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });

        const bounds = new google.maps.LatLngBounds(
          { lat: request.pickup_latitude, lng: request.pickup_longitude },
          { lat: request.destination_latitude, lng: request.destination_longitude },
        );
        map.fitBounds(bounds, 60);

        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => {
        /* map failed to load — UI still works */
      });

    return () => {
      cancelled = true;
      if (pickupMarkerRef.current) { pickupMarkerRef.current.setMap(null); pickupMarkerRef.current = null; }
      if (destMarkerRef.current) { destMarkerRef.current.setMap(null); destMarkerRef.current = null; }
      if (carMarkerRef.current) { carMarkerRef.current.setMap(null); carMarkerRef.current = null; }
      if (routePolylineRef.current) { routePolylineRef.current.setMap(null); routePolylineRef.current = null; }
      if (liveRoutePolylineRef.current) { liveRoutePolylineRef.current.setMap(null); liveRoutePolylineRef.current = null; }
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
    };
  }, [
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
  ]);

  // ── Real road route (pickup -> destination) ──
  useEffect(() => {
    let active = true;
    computeRoute(
      { lat: request.pickup_latitude, lng: request.pickup_longitude },
      { lat: request.destination_latitude, lng: request.destination_longitude },
      { travelMode: 'DRIVE', language: 'bg', units: 'METRIC' },
    )
      .then((res) => {
        if (active && res?.success) setRouteInfo(res);
      })
      .catch(() => {
        /* fall back */
      });
    return () => {
      active = false;
    };
  }, [
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
  ]);

  // ── Draw / update route polyline ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (routeInfo?.polyline) {
      let pts: { lat: number; lng: number }[] = [];
      try {
        pts = decodePolyline(routeInfo.polyline);
      } catch {
        return;
      }
      if (pts.length < 2) return;

      const path = pts.map((p) => ({ lat: p.lat, lng: p.lng }));

      if (!routePolylineRef.current) {
        routePolylineRef.current = new google.maps.Polyline({
          path,
          map,
          strokeColor: ROUTE_COLOR,
          strokeWeight: 4,
          strokeOpacity: 0.85,
        });
      } else {
        routePolylineRef.current.setPath(path);
      }
    }
  }, [routeInfo, mapReady]);

  // ── Pickup & destination markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pickupPos = { lat: request.pickup_latitude, lng: request.pickup_longitude };
    const destPos = { lat: request.destination_latitude, lng: request.destination_longitude };

    if (!pickupMarkerRef.current) {
      pickupMarkerRef.current = new google.maps.Marker({
        position: pickupPos,
        map,
        icon: pickupIcon(),
      });
    } else {
      pickupMarkerRef.current.setPosition(pickupPos);
    }

    if (!destMarkerRef.current) {
      destMarkerRef.current = new google.maps.Marker({
        position: destPos,
        map,
        zIndex: 100,
        icon: destIcon(),
      });
    } else {
      destMarkerRef.current.setPosition(destPos);
    }
  }, [
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
    mapReady,
  ]);

  // ── Computed stats ──
  const straightTripKm = useMemo(
    () =>
      calculateDistance(
        request.pickup_latitude,
        request.pickup_longitude,
        request.destination_latitude,
        request.destination_longitude,
      ),
    [
      request.pickup_latitude,
      request.pickup_longitude,
      request.destination_latitude,
      request.destination_longitude,
    ],
  );
  const roadFactor =
    routeInfo && straightTripKm > 0 ? Math.max(1, routeInfo.distance_km / straightTripKm) : 1;

  const distanceToTarget = location
    ? calculateDistance(location.latitude, location.longitude, targetLat, targetLng)
    : null;
  const roadDistanceToTarget =
    distanceToTarget !== null ? distanceToTarget * roadFactor : null;
  const etaMinutes =
    liveRoute?.duration_min ??
    (roadDistanceToTarget !== null ? estimateDuration(roadDistanceToTarget) : null);
  const remainingKm = liveRoute?.distance_km ?? roadDistanceToTarget;

  // ── Live road route (driver -> target) ──
  useEffect(() => {
    if (!location) return;
    const now = Date.now();
    const last = lastRouteFetchRef.current;
    const movedFar =
      calculateDistance(location.latitude, location.longitude, last.lat, last.lng) > 0.25;
    const stale = now - last.at > 45000;
    if (!movedFar && !stale) return;
    lastRouteFetchRef.current = { lat: location.latitude, lng: location.longitude, at: now };
    let active = true;
    computeRoute(
      { lat: location.latitude, lng: location.longitude },
      { lat: targetLat, lng: targetLng },
      { travelMode: 'DRIVE', language: 'bg', units: 'METRIC' },
    )
      .then((res) => {
        if (active && res?.success) {
          setLiveRoute({ distance_km: res.distance_km, duration_min: res.duration_min });
        }
      })
      .catch(() => {
        /* keep heuristic ETA */
      });
    return () => {
      active = false;
    };
  }, [location, targetLat, targetLng]);

  // ── Apply location + auto-pan + car marker update ──
  const applyLocation = useCallback(
    (lat: number, lng: number, heading: number | null, speed: number | null, updatedAt: string | null) => {
      const prev = prevPosRef.current;
      const effHeading =
        heading && heading > 0
          ? heading
          : prev
            ? (() => {
                const f1 = (prev.lat * Math.PI) / 180;
                const f2 = (lat * Math.PI) / 180;
                const dl = ((lng - prev.lng) * Math.PI) / 180;
                const y = Math.sin(dl) * Math.cos(f2);
                const x =
                  Math.cos(f1) * Math.sin(f2) -
                  Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
                return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
              })()
            : 0;

      prevPosRef.current = { lat, lng };
      setLocation(previous => previous?.latitude === lat && previous.longitude === lng && previous.heading === effHeading && previous.speed === speed ? previous : { latitude: lat, longitude: lng, heading: effHeading, speed });
      setLastUpdateAt(Date.parse(updatedAt ?? '') || 0);
      setPositionStale(!isFreshTimestamp(updatedAt));

      const map = mapRef.current;
      if (!map) return;

      // Update or create car marker
      if (!carMarkerRef.current) {
        carMarkerRef.current = new google.maps.Marker({
          position: { lat, lng },
          map,
          zIndex: 1000,
          icon: carSymbol(effHeading, vehicleType),
        });
        // First fix — fit the driver + pickup + destination into one view
        const b = new google.maps.LatLngBounds();
        b.extend({ lat, lng });
        b.extend({ lat: request.pickup_latitude, lng: request.pickup_longitude });
        b.extend({ lat: request.destination_latitude, lng: request.destination_longitude });
        map.fitBounds(b, 60);
        lastRecenterRef.current = Date.now();
      } else {
        carMarkerRef.current.setPosition({ lat, lng });
        carMarkerRef.current.setIcon(carSymbol(effHeading, vehicleType));
      }

      // Auto-pan if the car is near the edge of the viewport
      const now = Date.now();
      if (now - lastRecenterRef.current > 6000) {
        const bounds = map.getBounds();
        if (!bounds) return;
        const pad = 0.12;
        const latRange = bounds.getNorth() - bounds.getSouth();
        const lngRange = bounds.getEast() - bounds.getWest();
        const latMin = bounds.getSouth() + latRange * pad;
        const latMax = bounds.getNorth() - latRange * pad;
        const lngMin = bounds.getWest() + lngRange * pad;
        const lngMax = bounds.getEast() - lngRange * pad;
        if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) {
          lastRecenterRef.current = now;
          map.panTo({ lat, lng });
        }
      }
    },
    [
      vehicleType,
      request.pickup_latitude,
      request.pickup_longitude,
      request.destination_latitude,
      request.destination_longitude,
    ],
  );

  // Re-place the car marker once the map finishes loading (in case a location arrived earlier)
  useEffect(() => {
    if (mapReady && location) {
      applyLocation(location.latitude, location.longitude, location.heading, location.speed, lastUpdateAt ? new Date(lastUpdateAt).toISOString() : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // ── Stale position detection ──
  useEffect(() => {
    if (!location) return;
    const interval = setInterval(() => {
      const age = Date.now() - lastUpdateAt;
      setPositionStale(age > 60000);
    }, 10000);
    return () => clearInterval(interval);
  }, [location, lastUpdateAt]);

  // ── Polling fallback for driver location ──
  useEffect(() => {
    if (!request.driver_id) return;
    let mounted = true;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('driver_locations')
          .select('latitude, longitude, heading, speed, updated_at')
          .eq('driver_id', request.driver_id)
          .maybeSingle();
        if (data && mounted) {
          applyLocation(data.latitude, data.longitude, data.heading ?? null, data.speed ?? null, data.updated_at);
        }
      } catch {
        /* silently ignore */
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [request.driver_id, applyLocation]);

  // ── Load driver profile + vehicle type + subscribe to live location ──
  useEffect(() => {
    if (!request.driver_id) return;
    let active = true;

    const load = async () => {
      try {
        const { data: driver } = await supabase
          .from('drivers')
          .select('user_id, rating, total_trips, vehicle_id')
          .eq('id', request.driver_id)
          .maybeSingle();

        let name = '';
        let phone = '';
        let avatarUrl: string | null = null;
        let vehicleLabel = '';
        let rating = 0;
        let totalTrips = 0;
        let vType = 'standard';

        if (driver) {
          rating = parseFloat(String(driver.rating || 0));
          totalTrips = driver.total_trips || 0;

          const { data: u } = await supabase
            .from('profiles')
            .select('first_name, last_name, phone, avatar_url')
            .eq('id', driver.user_id)
            .maybeSingle();

          if (u) {
            name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
            phone = u.phone || '';
            avatarUrl = u.avatar_url || null;
          }

          if (driver.vehicle_id) {
            const { data: v } = await supabase
              .from('vehicles')
              .select('make, model, color, registration_number, vehicle_type_id')
              .eq('id', driver.vehicle_id)
              .maybeSingle();

            if (v) {
              vehicleLabel = [v.make, v.model, v.color, v.registration_number]
                .filter(Boolean)
                .join(' · ');

              if (v.vehicle_type_id) {
                const { data: vt } = await supabase
                  .from('vehicle_types')
                  .select('name')
                  .eq('id', v.vehicle_type_id)
                  .maybeSingle();
                if (vt?.name) {
                  const normalized = vt.name.toLowerCase();
                  if (normalized.includes('comfort')) vType = 'comfort';
                  else if (normalized.includes('van')) vType = 'van';
                  else if (normalized.includes('eco')) vType = 'standard';
                }
              }
            }
          }
        }

        if (active) {
          setDriverInfo({
            name: name || t('role_driver'),
            phone,
            avatar_url: avatarUrl,
            rating,
            total_trips: totalTrips,
            vehicle_label: vehicleLabel,
          });
          setVehicleType(vType);
        }

        const { data: loc } = await supabase
          .from('driver_locations')
          .select('latitude, longitude, heading, speed, updated_at')
          .eq('driver_id', request.driver_id)
          .maybeSingle();

        if (active && loc) {
          applyLocation(loc.latitude, loc.longitude, loc.heading ?? null, loc.speed ?? null, loc.updated_at);
        }
      } catch (err) {
        console.error('DriverTracking load error:', err);
      } finally {
        if (active) setLoadingInfo(false);
      }
    };

    load();

    const channel = supabase
      .channel(`driver-location-${request.driver_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'driver_locations',
          filter: `driver_id=eq.${request.driver_id}`,
        },
        (payload) => {
          if (
            payload.new &&
            typeof payload.new.latitude === 'number' &&
            typeof payload.new.longitude === 'number'
          ) {
            applyLocation(
              payload.new.latitude,
              payload.new.longitude,
              payload.new.heading ?? null,
              payload.new.speed ?? null,
              payload.new.updated_at ?? null,
            );
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'driver_locations',
          filter: `driver_id=eq.${request.driver_id}`,
        },
        (payload) => {
          if (
            payload.new &&
            typeof payload.new.latitude === 'number' &&
            typeof payload.new.longitude === 'number'
          ) {
            applyLocation(
              payload.new.latitude,
              payload.new.longitude,
              payload.new.heading ?? null,
              payload.new.speed ?? null,
              payload.new.updated_at ?? null,
            );
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [request.driver_id, applyLocation, t]);

  // ── Driver-found notification ──
  useEffect(() => {
    if (request.status === 'accepted' || request.status === 'arrived') {
      setShowBanner(true);
      const timer = setTimeout(playChime, 350);
      return () => clearTimeout(timer);
    }
  }, [request.status]);

  // ── Map controls ──
  const changeZoom = useCallback((delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.setZoom(map.getZoom() + delta);
  }, []);

  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || !location) return;
    map.panTo({ lat: location.latitude, lng: location.longitude });
  }, [location]);

  const speedKmh =
    location && typeof location.speed === 'number' ? Math.round(location.speed * 3.6) : null;

  const handleCancel = async () => {
    if (!onCancel) return;
    setCancelError(''); setCancelling(true);
    try {
      const {data,error} = await supabase.from('taxi_requests').update({status:'cancelled'})
        .eq('id',request.id).eq('status',request.status).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Заявката вече е променена.');
      onCancel();
    } catch(error) { setCancelError(error instanceof Error ? error.message : 'Отмяната не е потвърдена.'); }
    finally { setCancelling(false); }
  };

  return (
    <div className="relative h-screen bg-background-50 overflow-hidden">
      {cancelError && <p role="alert" className="absolute top-16 inset-x-3 z-30 p-3 text-red-700 bg-red-50">{cancelError}</p>}
      {/* ===== Google Map ===== */}
      <div ref={mapContainerRef} className="absolute inset-0 z-0" />

      {/* Top/bottom gradients */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/45 to-transparent pointer-events-none z-[5]" />
      <div className="absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/55 to-transparent pointer-events-none z-[5]" />

      {/* Stale position warning */}
      {positionStale && location && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[20] bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2 shadow-sm">
          <i className="ri-time-line text-amber-600 text-sm" />
          <span className="text-xs text-amber-700 font-medium">{t('position_not_updating')}</span>
        </div>
      )}

      {/* ===== Header ===== */}
      <header className="absolute top-0 left-0 right-0 z-10 px-4 py-3 flex items-center gap-2">
        <button
          onClick={() => navigate('/customer/orders')}
          className="w-9 h-9 flex items-center justify-center rounded-full bg-white/90 backdrop-blur text-foreground-700 hover:bg-white transition-colors cursor-pointer flex-shrink-0"
        >
          <i className="ri-arrow-left-line text-lg" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-white font-heading leading-tight">{t('live_tracking')}</p>
          <p className="text-xs text-white/85 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-400 animate-pulse" />
            {t('live')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => changeZoom(1)}
            aria-label={t('zoom_in')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/90 backdrop-blur text-foreground-700 hover:bg-white transition-all cursor-pointer active:scale-95"
          >
            <i className="ri-add-line text-lg" />
          </button>
          <button
            onClick={() => changeZoom(-1)}
            aria-label={t('zoom_out')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/90 backdrop-blur text-foreground-700 hover:bg-white transition-all cursor-pointer active:scale-95"
          >
            <i className="ri-subtract-line text-lg" />
          </button>
          <button
            onClick={recenter}
            aria-label={t('recenter_map')}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/90 backdrop-blur text-primary-600 hover:bg-white transition-all cursor-pointer active:scale-95"
          >
            <i className="ri-crosshair-2-line text-lg" />
          </button>
        </div>
      </header>

      {/* ===== Driver found banner ===== */}
      {showBanner && driverInfo && (
        <div className="absolute top-16 left-0 right-0 z-10 px-4 pt-1">
          <div className="bg-white/95 backdrop-blur-xl rounded-xl p-3 border-2 border-accent-400 animate-in slide-in-from-top-4 fade-in duration-300">
            <div className="flex items-center gap-3">
              {driverInfo.avatar_url ? (
                <img src={driverInfo.avatar_url} alt={driverInfo.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-accent-500 flex items-center justify-center flex-shrink-0">
                  <i className="ri-check-double-line text-white text-lg" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-accent-600 uppercase tracking-wider">{t('driver_found')}</p>
                <p className="text-sm font-bold text-foreground-950 font-heading truncate leading-tight">
                  {driverInfo.name} <span className="font-normal text-foreground-500 text-xs">{t('is_on_the_way')}</span>
                </p>
                {driverInfo.vehicle_label && (
                  <p className="text-[11px] text-foreground-500 truncate flex items-center gap-1 mt-0.5">
                    <i className="ri-car-line text-accent-600 text-[10px]" />{driverInfo.vehicle_label}
                  </p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-lg font-bold text-primary-600 font-heading leading-none">
                  {etaMinutes ?? '—'}<span className="text-[10px] font-normal text-foreground-500 ml-0.5">{t('min')}</span>
                </p>
                <p className="text-[10px] text-foreground-500 mt-0.5">{t('arriving_in')}</p>
              </div>
              <button
                onClick={() => setShowBanner(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer flex-shrink-0"
              >
                <i className="ri-close-line text-foreground-400" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Compact bottom panel ===== */}
      <div className="absolute bottom-0 inset-x-0 z-10 px-3 pb-3">
        <div className="bg-white rounded-xl p-3 animate-in slide-in-from-bottom-4 fade-in duration-300 max-h-[36vh] overflow-y-auto">
          {/* Driver row */}
          <div className="flex items-center gap-2.5 mb-2">
            {driverInfo?.avatar_url ? (
              <img src={driverInfo.avatar_url} alt={driverInfo.name} className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0">
                <i className="ri-user-3-line text-accent-600 text-sm" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-foreground-950 font-heading truncate">
                {loadingInfo ? t('loading') : driverInfo?.name}
              </p>
              {driverInfo && !loadingInfo && (
                <div className="flex items-center gap-1 text-[11px] text-foreground-500">
                  <i className="ri-star-fill text-primary-500 text-[10px]" />
                  <span className="font-medium text-foreground-700">{driverInfo.rating.toFixed(1)}</span>
                  <span>·</span>
                  <span>{driverInfo.total_trips} {t('trips')}</span>
                </div>
              )}
            </div>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent-50 text-accent-600 text-[10px] font-semibold flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse" />{t('live')}
            </span>
          </div>

          {/* Status + speed on one row */}
          <div className="flex items-center gap-2 text-[11px] font-medium text-foreground-600 bg-background-50 rounded-lg px-2.5 py-1.5 mb-2">
            <i className="ri-roadster-line text-accent-600 text-xs" />
            <span className="truncate">
              {isWaiting
                ? t('driver_waiting')
                : headingToPickup
                  ? `${t('status_accepted')} · ${t('heading_to_you')}`
                  : t('trip_in_progress_note')}
            </span>
            {speedKmh !== null && (
              <span className="ml-auto flex items-center gap-1 flex-shrink-0 text-foreground-400">
                <i className="ri-speed-up-line" />{speedKmh} {t('km')}/h
              </span>
            )}
          </div>

          {/* ETA + distance compact */}
          {!isWaiting ? (
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-accent-50 rounded-lg p-2">
                <p className="text-[10px] text-foreground-500 mb-0.5">{t('arriving_in')}</p>
                <p className="text-xl font-bold text-foreground-950 font-heading leading-none">
                  {etaMinutes ?? '—'}<span className="text-[10px] font-normal text-foreground-500 ml-1">{t('min')}</span>
                </p>
              </div>
              <div className="bg-background-50 rounded-lg p-2">
                <p className="text-[10px] text-foreground-500 mb-0.5">{t('remaining_distance')}</p>
                <p className="text-xl font-bold text-foreground-950 font-heading leading-none">
                  {remainingKm !== null && remainingKm !== undefined ? remainingKm.toFixed(1) : '—'}
                  <span className="text-[10px] font-normal text-foreground-500 ml-1">{t('km')}</span>
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-accent-50 rounded-lg p-2 mb-2 flex items-center gap-2">
              <i className="ri-time-line text-accent-600 text-xs" />
              <p className="text-xs font-medium text-foreground-800">{t('driver_waiting')} · {request.pickup_address}</p>
            </div>
          )}

          {/* Route line */}
          <div className="flex items-start gap-2 mb-2">
            <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
              <div className="w-2 h-2 rounded-full bg-accent-500" />
              <div className="w-px h-5 bg-background-200 my-0.5" />
              <div className="w-2 h-2 rounded bg-foreground-400" />
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-[11px] text-foreground-500 truncate">{request.pickup_address}</p>
              <p className="text-[11px] text-foreground-500 truncate">{request.destination_address}</p>
            </div>
          </div>

          {/* Trip total */}
          {routeInfo && (
            <p className="text-[10px] text-foreground-400 mb-2 flex items-center gap-1">
              <i className="ri-route-line text-accent-500 text-[10px]" />
              {t('trip_route')}: {routeInfo.distance_km.toFixed(1)} {t('km')} · ~{routeInfo.duration_min} {t('min')}
            </p>
          )}

          {/* Actions row — call + cancel */}
          <div className="grid grid-cols-2 gap-2">
            <a
              href={driverInfo?.phone ? `tel:${driverInfo.phone}` : '#'}
              className={`py-2.5 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap flex items-center justify-center gap-1.5 cursor-pointer
                ${driverInfo?.phone ? 'bg-accent-500 text-white hover:bg-accent-600 active:scale-[0.98]' : 'bg-background-100 text-foreground-400 pointer-events-none'}`}
            >
              <i className="ri-phone-line" />{t('call_driver')}
            </a>
            {canCancel && (
              <button
                onClick={() => setCancelConfirm(true)}
                className="py-2.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5"
              >
                <i className="ri-close-circle-line" />{t('cancel_request')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel confirmation modal */}
      {cancelConfirm && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCancelConfirm(false)} />
          <div className="relative bg-white rounded-t-2xl w-full max-w-md p-5 pb-7 animate-in slide-in-from-bottom-6 fade-in duration-300">
            <div className="w-10 h-1 rounded-full bg-background-200 mx-auto mb-4" />
            <p className="text-sm text-foreground-700 text-center mb-4">{t('confirm_cancel')}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setCancelConfirm(false)}
                className="py-3 rounded-xl bg-background-100 text-foreground-600 text-sm font-semibold hover:bg-background-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                {t('keep_request')}
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="py-3 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 active:scale-[0.98] transition-all whitespace-nowrap cursor-pointer disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {cancelling ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <i className="ri-close-circle-line" />
                )}
                {t('yes_cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}