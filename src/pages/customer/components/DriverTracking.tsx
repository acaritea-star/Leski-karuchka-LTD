import { isFreshTimestamp } from '@/lib/driverLocation';
/* global google */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { calculateDistance, estimateDuration } from '@/lib/geo';
import { computeRoute, decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import CustomerLayout from './CustomerLayout';
import AppMenu from './AppMenu';

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

const ROUTE_COLOR = '#315943';
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
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [liveRoute, setLiveRoute] = useState<{ distance_km: number; duration_min: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError,setCancelError] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [vehicleType, setVehicleType] = useState<string>('standard');
  const [positionStale, setPositionStale] = useState(false);
  const [lastUpdateAt, setLastUpdateAt] = useState<number>(0);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);

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
    request.status === 'accepted' || request.status === 'arrived';

  const targetLat = headingToPickup ? request.pickup_latitude : request.destination_latitude;
  const targetLng = headingToPickup ? request.pickup_longitude : request.destination_longitude;

  // ── Initialise Google map (once) ──
  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || mapRef.current) return;

    let cancelled = false;
    setMapReady(false);
    setMapError(false);
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
        map.fitBounds(bounds, { top: 94, bottom: 40, left: window.innerWidth >= 768 ? 462 : 40, right: 40 });

        mapRef.current = map;
        setMapReady(true);
      })
      .catch(() => {
        if (!cancelled) setMapError(true);
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
    mapAttempt,
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
        map.fitBounds(b, { top: 94, bottom: 40, left: window.innerWidth >= 768 ? 462 : 40, right: 40 });
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
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        const latRange = ne.lat() - sw.lat();
        const lngRange = ne.lng() - sw.lng();
        const latMin = sw.lat() + latRange * pad;
        const latMax = ne.lat() - latRange * pad;
        const lngMin = sw.lng() + lngRange * pad;
        const lngMax = ne.lng() - lngRange * pad;
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
    if (!onCancel || cancelling) return;
    setCancelError(''); setCancelling(true);
    try {
      const {data,error} = await supabase.from('taxi_requests').update({status:'cancelled'})
        .eq('id',request.id).eq('status',request.status).select('id').single();
      if (error || !data) throw new Error(error?.message ?? 'Заявката вече е променена.');
      onCancel();
    } catch(error) { setCancelError(error instanceof Error ? error.message : 'Отмяната не е потвърдена.'); }
    finally { setCancelling(false); }
  };

  return <CustomerLayout
    map={<>
      <div ref={mapContainerRef} className="absolute inset-0" />
      {!mapReady && <div className="booking-map-state" role="status">
        {mapError ? <><p>{t('booking_map_error')}</p>
          <button type="button" className="booking-secondary" onClick={() => setMapAttempt(n => n + 1)}>{t('booking_retry')}</button></>
          : <><span className="booking-spinner" /><p>{t('booking_map_loading')}</p></>}
      </div>}
      {mapReady && <div className="tracking-map-controls">
        <button type="button" className="booking-icon-button" onClick={() => changeZoom(1)} aria-label={t('zoom_in')}><i className="ri-add-line" /></button>
        <button type="button" className="booking-icon-button" onClick={() => changeZoom(-1)} aria-label={t('zoom_out')}><i className="ri-subtract-line" /></button>
      </div>}
    </>}
    header={<>
      <button type="button" className="booking-icon-button" onClick={() => navigate('/customer/orders')} aria-label={t('nav_orders')}><i className="ri-arrow-left-line" /></button>
      <div className="customer-brand"><span>{t('live_tracking')}<small>{t('app_name')}</small></span></div>
      <div className="customer-header-actions">
        <button type="button" className="booking-icon-button" onClick={recenter} aria-label={t('recenter_map')}><i className="ri-focus-3-line" /></button><AppMenu />
      </div>
    </>}
    notice={positionStale && location ? <><i className="ri-time-line" />{t('position_not_updating')}</> : undefined}
  >
    <div className="booking-status booking-enter">
      <div className="booking-status-heading" role="status">
        <div className="booking-status-icon"><i className={isWaiting ? 'ri-map-pin-user-line' : 'ri-taxi-line'} aria-hidden="true" /></div>
        <div className="min-w-0">
          <h2>{isWaiting ? t('driver_waiting') : headingToPickup ? t('heading_to_you') : t('status_in_progress')}</h2>
          <p>{location && !positionStale && etaMinutes != null && !isWaiting
            ? `${t('arriving_in')} ~${etaMinutes} ${t('min')}`
            : isWaiting ? t('booking_meet_driver') : t('booking_waiting_location')}</p>
        </div>
      </div>
      <div className="booking-scroll">
        {cancelConfirm ? <div className="booking-cancel-confirm">
          <p>{t('confirm_cancel')}</p><div>
            <button type="button" className="booking-secondary" disabled={cancelling} onClick={() => setCancelConfirm(false)}>{t('keep_request')}</button>
            <button type="button" className="booking-secondary booking-danger" disabled={cancelling} onClick={handleCancel}>{cancelling ? t('booking_cancel_sending') : t('yes_cancel')}</button>
          </div>
        </div> : <>
          <div className="tracking-driver">
            {driverInfo?.avatar_url ? <img src={driverInfo.avatar_url} alt="" />
              : <span className="tracking-avatar" aria-hidden="true"><i className="ri-user-3-line" /></span>}
            <div className="min-w-0 flex-1"><strong>{loadingInfo ? t('loading') : driverInfo?.name || t('booking_driver_connecting')}</strong>
              {driverInfo?.vehicle_label && <small>{driverInfo.vehicle_label}</small>}
            </div>
            {driverInfo && driverInfo.total_trips > 0 && <span className="tracking-rating"><i className="ri-star-fill" aria-hidden="true" /> {driverInfo.rating.toFixed(1)}</span>}
          </div>
          <div className="booking-status-route">
            <p><span className="route-dot" aria-hidden="true" /><span title={request.pickup_address}>{request.pickup_address}</span></p>
            <p><span className="route-dot route-dot-end" aria-hidden="true" /><span title={request.destination_address}>{request.destination_address}</span></p>
          </div>
        </>}
        {cancelError && <p className="booking-error" role="alert">{cancelError}</p>}
      </div>
      <div className="booking-status-actions">
        {driverInfo?.phone && <a className="booking-primary" href={`tel:${driverInfo.phone}`}><i className="ri-phone-line" aria-hidden="true" />{t('call_driver')}</a>}
        {canCancel && onCancel && !cancelConfirm && <button type="button" className="booking-secondary" onClick={() => setCancelConfirm(true)}>{t('cancel_request')}</button>}
      </div>
    </div>
  </CustomerLayout>;
}
