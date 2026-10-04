/* global google */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { calculateDistance, estimateDuration } from '@/lib/geo';
import { computeRoute, decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { useDriverPosition, usePositionFreshness } from '@/hooks/useDriverPosition';
import { useDrivingRoute } from '@/hooks/useDrivingRoute';
import { useRoadNetwork } from '@/hooks/useRoadNetwork';
import { RoadAttribution } from '@/pages/customer/components/NearbyCars';
import { useVehicleMarker } from '@/hooks/useVehicleMarker';
import { updateRouteLayer, type RouteLayerState, mapPinIcon, MAP_PICKUP_COLOR, type RouteLine } from '@/lib/mapLayers';
import { measureRoute } from '@/lib/routeGeometry';
import { remainingRouteEstimate } from '@/lib/routeProgress';
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

const NO_ROUTE: import('@/lib/googleMaps').RoutePoint[] = [];
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
  const location = useDriverPosition(request.driver_id);
  const positionStale = !usePositionFreshness(location);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError,setCancelError] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [vehicleType, setVehicleType] = useState<string>('standard');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);

  // Google Maps refs
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const activeLineRef = useRef<RouteLine | null>(null);
  const roadLayers = useRef<{ base: RouteLayerState | null; active: RouteLayerState | null }>({ base: null, active: null });
  const fittedMapRef = useRef<google.maps.Map | null>(null);
  const lastRecenterRef = useRef(0);

  const headingToPickup = request.status === 'accepted' || request.status === 'arrived';
  const isWaiting = request.status === 'arrived';
  const canCancel =
    request.status === 'accepted' || request.status === 'arrived';

  const targetLat = headingToPickup ? request.pickup_latitude : request.destination_latitude;
  const targetLng = headingToPickup ? request.pickup_longitude : request.destination_longitude;

  const { info: liveRoute, path: livePath } = useDrivingRoute(location, targetLat, targetLng,
    { requestId: request.id, purpose: headingToPickup ? 'pickup' : 'destination' });
  const tripPath = useMemo(() => routeInfo?.polyline ? measureRoute(decodePolyline(routeInfo.polyline)).points : [], [routeInfo]);
  const motionPath = livePath.length ? livePath : headingToPickup ? NO_ROUTE : tripPath;
  const roadNetwork = useRoadNetwork(location);
  const vehicleFrame = useVehicleMarker(mapReady ? mapRef.current : null, location, motionPath, CAR_COLORS[vehicleType] || CAR_COLORS.standard,
    frame => { if (motionPath.length >= 2) activeLineRef.current?.follow(frame); }, roadNetwork, true);

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
      roadLayers.current.base?.line.remove(); roadLayers.current.active?.line.remove();
      roadLayers.current = { base: null, active: null }; activeLineRef.current = null;
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
    };
  }, [
    mapAttempt,
    request.id,
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
  ]);

  // ── Real road route (pickup -> destination) ──
  useEffect(() => {
    let active = true;
    setRouteInfo(null);
    computeRoute(
      { lat: request.pickup_latitude, lng: request.pickup_longitude },
      { lat: request.destination_latitude, lng: request.destination_longitude },
      { travelMode: 'DRIVE', language: 'bg', units: 'METRIC', requestId: request.id, purpose: 'context' },
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
    request.id,
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
  ]);

  // The complete trip is a muted context line while the current leg is active.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layers = roadLayers.current;
    const activePath = livePath.length >= 2 ? livePath : headingToPickup ? NO_ROUTE : tripPath;
    layers.base = updateRouteLayer(layers.base, map, tripPath, { muted: headingToPickup || livePath.length >= 2 });
    layers.active = updateRouteLayer(layers.active, map,
      headingToPickup || livePath.length >= 2 ? activePath : NO_ROUTE,
      { color: headingToPickup ? MAP_PICKUP_COLOR : undefined, zIndex: 20 });
    activeLineRef.current = layers.active?.line ?? layers.base?.line ?? null;
    if (activePath.length >= 2 && vehicleFrame.current) activeLineRef.current?.follow(vehicleFrame.current);
  }, [tripPath, livePath, headingToPickup, mapReady, vehicleFrame]);

  // ── Pickup & destination markers ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const pickupPos = { lat: request.pickup_latitude, lng: request.pickup_longitude };
    const destPos = { lat: request.destination_latitude, lng: request.destination_longitude };

    if (!pickupMarkerRef.current) {
      pickupMarkerRef.current = new google.maps.Marker({
        position: pickupPos,
        map,
        icon: mapPinIcon('pickup'),
        title: `A · ${request.pickup_address}`,
        zIndex: 1100,
      });
    } else {
      pickupMarkerRef.current.setPosition(pickupPos);
    }

    if (!destMarkerRef.current) {
      destMarkerRef.current = new google.maps.Marker({
        position: destPos,
        map,
        zIndex: 1100,
        icon: mapPinIcon('destination'),
        title: `B · ${request.destination_address}`,
      });
    } else {
      destMarkerRef.current.setPosition(destPos);
    }
  }, [
    request.pickup_latitude,
    request.pickup_longitude,
    request.destination_latitude,
    request.destination_longitude,
    request.pickup_address,
    request.destination_address,
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
    ? calculateDistance(location.lat, location.lng, targetLat, targetLng)
    : null;
  const roadDistanceToTarget =
    distanceToTarget !== null ? distanceToTarget * roadFactor : null;
  const measuredLive = useMemo(() => measureRoute(livePath), [livePath]);
  const liveEstimate = remainingRouteEstimate(liveRoute, measuredLive, location);
  const etaMinutes = liveRoute
    ? liveEstimate?.durationMinutes ?? null
    : roadDistanceToTarget !== null ? estimateDuration(roadDistanceToTarget) : null;

  // Fit once after GPS and Maps have both arrived, then follow only near an edge.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !location) return;
    if (fittedMapRef.current !== map) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(location);
      bounds.extend({ lat: request.pickup_latitude, lng: request.pickup_longitude });
      bounds.extend({ lat: request.destination_latitude, lng: request.destination_longitude });
      map.fitBounds(bounds, { top: 94, bottom: 40, left: window.innerWidth >= 768 ? 462 : 40, right: 40 });
      fittedMapRef.current = map;
      lastRecenterRef.current = Date.now();
    } else if (!positionStale && Date.now() - lastRecenterRef.current > 6000) {
      const bounds = map.getBounds();
      if (!bounds) return;
      const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
      const dy = (ne.lat() - sw.lat()) * 0.12, dx = (ne.lng() - sw.lng()) * 0.12;
      if (location.lat < sw.lat() + dy || location.lat > ne.lat() - dy || location.lng < sw.lng() + dx || location.lng > ne.lng() - dx) {
        lastRecenterRef.current = Date.now();
        map.panTo(location);
      }
    }
  }, [mapReady, location, positionStale, request.pickup_latitude, request.pickup_longitude, request.destination_latitude, request.destination_longitude]);

  // ── Load driver profile + vehicle type ──
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

      } catch (err) {
        console.error('DriverTracking load error:', err);
      } finally {
        if (active) setLoadingInfo(false);
      }
    };

    load();

    return () => { active = false; };
  }, [request.driver_id, t]);

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
    map.panTo({ lat: location.lat, lng: location.lng });
  }, [location]);

  const handleCancel = async () => {
    if (!onCancel || cancelling) return;
    setCancelError(''); setCancelling(true);
    try {
      const {data,error} = await supabase.from('taxi_requests').update({status:'cancelled',cancel_reason:'customer_requested'})
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
      {mapReady && roadNetwork && <RoadAttribution />}
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
            <p><span className="route-pin-label" aria-hidden="true">A</span><span title={request.pickup_address}>{request.pickup_address}</span></p>
            <p><span className="route-pin-label route-pin-label-end" aria-hidden="true">B</span><span title={request.destination_address}>{request.destination_address}</span></p>
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
