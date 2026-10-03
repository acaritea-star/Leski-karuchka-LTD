/* global google */
import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import type { RoutePoint } from '@/lib/googleMaps';
import { useDriverPosition, usePositionFreshness } from '@/hooks/useDriverPosition';
import { useDrivingRoute } from '@/hooks/useDrivingRoute';
import { useVehicleMarker } from '@/hooks/useVehicleMarker';
import { drawRouteLine, mapPinIcon, MAP_PICKUP_COLOR, type RouteLine } from '@/lib/mapLayers';
import { matchRoute, measureRoute } from '@/lib/routeGeometry';
import { freshFix, type VehicleFix } from '@/lib/vehicleMotion';

export interface NavInfo {
  distance_km: number;
  duration_min: number;
  instruction: string | null;
  next_step_meters: number | null;
}
interface DriverRouteMapProps {
  targetLat: number;
  targetLng: number;
  driverId?: string | null;
  pickup?: RoutePoint;
  destination?: RoutePoint;
  targetKind?: 'pickup' | 'destination';
  onNavInfo?: (info: NavInfo | null) => void;
}
function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function DriverRouteMap({ targetLat, targetLng, driverId, pickup, destination,
  targetKind = 'destination', onNavInfo }: DriverRouteMapProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const activeLineRef = useRef<RouteLine | null>(null);
  const lastPanRef = useRef(0);
  const fittedMapRef = useRef<google.maps.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [localFix, setLocalFix] = useState<VehicleFix | null>(null);
  const localFresh = usePositionFreshness(localFix);
  const serverFix = useDriverPosition(driverId, !localFresh);
  const pos = localFresh ? localFix : serverFix ?? localFix;
  const positionFresh = usePositionFreshness(pos);
  const { info: routeInfo, path: routePath, error: routeError } = useDrivingRoute(pos, targetLat, targetLng);
  const vehicleFrame = useVehicleMarker(mapReady ? mapRef.current : null, pos, routePath, undefined,
    frame => { if (routePath.length >= 2) activeLineRef.current?.follow(frame); });

  useEffect(() => {
    let active = true;
    setMapReady(false); setMapError(false);
    loadGoogleMaps().then(() => {
      if (!active || !containerRef.current) return;
      mapRef.current = new google.maps.Map(containerRef.current, {
        center: { lat: targetLat, lng: targetLng }, zoom: 15, disableDefaultUI: true,
        gestureHandling: 'greedy', zoomControl: false, clickableIcons: false,
      });
      lastPanRef.current = 0;
      setMapReady(true);
    }).catch(() => { if (active) setMapError(true); });
    return () => {
      active = false;
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, [retry, targetLat, targetLng]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(position => {
      const { latitude: lat, longitude: lng, heading, speed, accuracy } = position.coords;
      const next: VehicleFix = { lat, lng, heading, speed, accuracy, timestamp: position.timestamp };
      if (!freshFix(next)) return;
      // Small fixes still accumulate in the route refresh gate. Comparing each
      // step to 50 m used to discard a whole trip made of smaller GPS updates.
      setLocalFix(previous => previous && previous.timestamp >= next.timestamp ? previous : next);
    }, () => { /* The server fix is used if the local GPS becomes stale. */ },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const pickupLat = pickup?.lat, pickupLng = pickup?.lng;
  const destinationLat = destination?.lat, destinationLng = destination?.lng;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const markers: google.maps.Marker[] = [];
    const start = pickupLat != null && pickupLng != null ? { lat: pickupLat, lng: pickupLng }
      : targetKind === 'pickup' ? { lat: targetLat, lng: targetLng } : null;
    const end = destinationLat != null && destinationLng != null ? { lat: destinationLat, lng: destinationLng }
      : targetKind === 'destination' ? { lat: targetLat, lng: targetLng } : null;
    if (start) markers.push(new google.maps.Marker({ map, position: start, icon: mapPinIcon('pickup'), zIndex: 1100, title: 'A · Начало' }));
    if (end) markers.push(new google.maps.Marker({ map, position: end, icon: mapPinIcon('destination'), zIndex: 1100, title: 'B · Край' }));
    return () => markers.forEach(marker => marker.setMap(null));
  }, [mapReady, pickupLat, pickupLng, destinationLat, destinationLng, targetLat, targetLng, targetKind]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || routePath.length < 2) return;
    const color = targetKind === 'pickup' ? MAP_PICKUP_COLOR : undefined;
    const base = drawRouteLine(map, routePath, { color, muted: true });
    const active = drawRouteLine(map, routePath, { color, zIndex: 20 });
    activeLineRef.current = active;
    if (vehicleFrame.current) active.follow(vehicleFrame.current);
    return () => { base.remove(); active.remove(); activeLineRef.current = null; };
  }, [mapReady, routePath, targetKind, vehicleFrame]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !pos || !positionFresh || Date.now() - lastPanRef.current < 6000) return;
    if (fittedMapRef.current !== map) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend(pos); bounds.extend({ lat: targetLat, lng: targetLng });
      map.fitBounds(bounds, { top: 115, bottom: 40, left: 35, right: 35 });
      fittedMapRef.current = map; lastPanRef.current = Date.now();
      return;
    }
    const bounds = map.getBounds();
    const ne = bounds?.getNorthEast(), sw = bounds?.getSouthWest();
    if (!ne || !sw || pos.lat > ne.lat() || pos.lat < sw.lat() || pos.lng > ne.lng() || pos.lng < sw.lng()) {
      map.panTo(pos);
      lastPanRef.current = Date.now();
    }
  }, [mapReady, pos, positionFresh, targetLat, targetLng]);

  const navInfo = useMemo<NavInfo | null>(() => {
    if (!routeInfo || !positionFresh) return null;
    const measured = measureRoute(routePath), match = pos ? matchRoute(pos, measured) : null;
    const ratio = match && match.distance <= 35 && measured.length > 0 ? Math.min(1, match.progress / measured.length) : 0;
    let travelled = routeInfo.distance_km * 1000 * ratio;
    const steps = routeInfo.legs.flatMap(leg => leg.steps);
    let step = steps[0];
    for (const candidate of steps) {
      step = candidate;
      if (!candidate.distance_meters || travelled < candidate.distance_meters) break;
      travelled -= candidate.distance_meters;
    }
    return { distance_km: Math.max(0, routeInfo.distance_km * (1 - ratio)),
      duration_min: Math.max(0, Math.ceil(routeInfo.duration_min * (1 - ratio))),
      instruction: step?.instruction ? stripHtml(step.instruction) : null,
      next_step_meters: step?.distance_meters != null ? Math.max(0, Math.round(step.distance_meters - travelled)) : null };
  }, [routeInfo, routePath, pos, positionFresh]);
  useEffect(() => { onNavInfo?.(navInfo); }, [onNavInfo, navInfo]);

  return <div className="relative w-full h-full" aria-label={t('trip_route')}>
    <div ref={containerRef} className="absolute inset-0" />
    {!mapReady && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background-50" role="status">
      <p className="text-sm text-foreground-600">{t(mapError ? 'booking_map_error' : 'booking_map_loading')}</p>
      {mapError && <button type="button" className="px-4 py-2 rounded-lg bg-white shadow text-sm" onClick={() => setRetry(value => value + 1)}>{t('booking_retry')}</button>}
    </div>}
    {mapReady && <>
      <div className="absolute top-3 left-3 right-3 bg-white rounded-xl shadow-lg px-4 py-3 pointer-events-none" role="status">
        {navInfo ? <>
          <div className="flex items-start gap-3">
            <i className="ri-direction-line text-xl text-primary-600 flex-shrink-0" aria-hidden="true" />
            <div className="min-w-0"><p className="text-sm font-semibold text-foreground-900">{navInfo.instruction || `Наближавате точка ${targetKind === 'pickup' ? 'A' : 'B'}`}</p>
              {navInfo.next_step_meters != null && <p className="text-xs text-foreground-500 mt-0.5">{navInfo.next_step_meters >= 1000 ? `${(navInfo.next_step_meters / 1000).toFixed(1)} км` : `${navInfo.next_step_meters} м`}</p>}
            </div>
          </div>
          <p className="text-xs text-foreground-500 mt-2">{navInfo.distance_km.toFixed(1)} км · ~{navInfo.duration_min} {t('min')}</p>
        </> : <p className="text-sm text-foreground-600">{!positionFresh ? t(pos ? 'position_not_updating' : 'booking_waiting_location') : routeError ? 'Маршрутът не се зареди. Опитваме отново…' : 'Изчисляване на маршрута…'}</p>}
      </div>
      <div className="absolute bottom-7 right-3 flex flex-col gap-2">
        <button type="button" className="w-10 h-10 bg-white rounded-lg shadow flex items-center justify-center" aria-label={t('recenter_map')}
          onClick={() => { if (pos) mapRef.current?.panTo(pos); }}><i className="ri-focus-3-line text-lg" aria-hidden="true" /></button>
      </div>
    </>}
  </div>;
}
