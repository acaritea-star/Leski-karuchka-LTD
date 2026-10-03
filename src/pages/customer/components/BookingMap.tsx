/* global google */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { LEVSKI_CENTER } from '@/lib/geo';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { drawRouteLine, mapPinIcon, type RouteLine } from '@/lib/mapLayers';
import type { BookingLocation } from './BookingCard';

export default function BookingMap({ pickup, destination, route, initialCenter }: {
  pickup: BookingLocation | null; destination: BookingLocation | null; route: RouteResult | null;
  initialCenter?: google.maps.LatLngLiteral;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const initialView = useRef(initialCenter ?? LEVSKI_CENTER);
  const pins = useRef<Array<google.maps.Marker | null>>([null, null]);
  const road = useRef<RouteLine | null>(null);
  const interaction = useRef(false);
  const endpointsSelected = useRef(false);
  endpointsSelected.current = !!pickup || !!destination;
  const pickupLat = pickup?.lat, pickupLng = pickup?.lng, pickupAddress = pickup?.address;
  const destinationLat = destination?.lat, destinationLng = destination?.lng, destinationAddress = destination?.address;
  const encoded = pickup && destination ? route?.polyline : undefined;
  const path = useMemo(() => encoded ? decodePolyline(encoded) : [], [encoded]);

  useEffect(() => {
    let active = true;
    setState('loading');
    loadGoogleMaps().then(() => {
      if (!active || !container.current) return;
      map.current = new google.maps.Map(container.current, {
        center: initialView.current, zoom: 14, disableDefaultUI: true, gestureHandling: 'greedy',
        clickableIcons: false, styles: [
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dedc' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f0f1e9' }] },
          { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dce8d4' }] },
        ],
      });
      setState('ready');
      // Quietly use an already granted location; never open a permission prompt on entry.
      if (navigator.permissions && navigator.geolocation) {
        navigator.permissions.query({ name: 'geolocation' }).then(permission => {
          if (!active || permission.state !== 'granted') return;
          navigator.geolocation.getCurrentPosition(position => {
            const { latitude: lat, longitude: lng, accuracy } = position.coords;
            if (active && !interaction.current && !endpointsSelected.current && accuracy <= 100
              && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
              && Math.abs(Date.now() - position.timestamp) <= 60_000) map.current?.panTo({ lat, lng });
          }, () => {}, { maximumAge: 30_000, timeout: 8_000, enableHighAccuracy: false });
        }).catch(() => {});
      }
    }).catch(() => { if (active) setState('error'); });
    return () => {
      active = false;
      pins.current.forEach(pin => pin?.setMap(null));
      pins.current = [null, null];
      road.current?.remove(); road.current = null;
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [retry]);

  // Keep layers alive through polling, quote refreshes and ordinary React renders.
  useEffect(() => {
    if (!map.current || state !== 'ready') return;
    [{ lat: pickupLat, lng: pickupLng, address: pickupAddress },
      { lat: destinationLat, lng: destinationLng, address: destinationAddress }].forEach((location, index) => {
      if (location.lat == null || location.lng == null) {
        pins.current[index]?.setMap(null); pins.current[index] = null; return;
      }
      const position = { lat: location.lat, lng: location.lng };
      const pin = pins.current[index];
      if (pin) { pin.setPosition(position); pin.setTitle(location.address ?? ''); }
      else pins.current[index] = new google.maps.Marker({ map: map.current, position,
        title: location.address, zIndex: 1100, icon: mapPinIcon(index === 0 ? 'pickup' : 'destination') });
    });
  }, [pickupLat, pickupLng, pickupAddress, destinationLat, destinationLng, destinationAddress, state]);

  useEffect(() => {
    if (!map.current || state !== 'ready') return;
    if (path.length < 2) { road.current?.remove(); road.current = null; }
    else if (road.current) road.current.setPath(path);
    else road.current = drawRouteLine(map.current, path);
  }, [path, state]);

  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap || state !== 'ready') return;
    const points: google.maps.LatLngLiteral[] = [];
    if (pickupLat != null && pickupLng != null) points.push({ lat: pickupLat, lng: pickupLng });
    if (destinationLat != null && destinationLng != null) points.push({ lat: destinationLat, lng: destinationLng });
    points.push(...path);
    const fit = () => {
      if (!points.length) return;
      const bounds = new google.maps.LatLngBounds();
      points.forEach(point => bounds.extend(point));
      // A single bounded view avoids fitBounds' maximum zoom followed by a second zoom jump.
      if (points.length === 1) {
        bounds.extend({ lat: points[0].lat - .003, lng: points[0].lng - .003 });
        bounds.extend({ lat: points[0].lat + .003, lng: points[0].lng + .003 });
      }
      currentMap.fitBounds(bounds, { top: 94, bottom: 38,
        left: window.matchMedia('(min-width: 768px)').matches ? 462 : 38, right: 38 });
    };
    fit();
    let width = container.current?.clientWidth;
    const resize = new ResizeObserver(() => {
      const nextWidth = container.current?.clientWidth;
      // Opening the keyboard changes height, not the chosen view.
      if (nextWidth !== width) { width = nextWidth; fit(); }
    });
    if (container.current) resize.observe(container.current);
    return () => resize.disconnect();
  }, [pickupLat, pickupLng, destinationLat, destinationLng, path, state]);

  return <>
    <div ref={container} onPointerDown={() => { interaction.current = true; }} className="absolute inset-0" aria-label={t('trip_route')} />
    {state !== 'ready' && <div className="booking-map-state" role="status">
      {state === 'loading' ? <><span className="booking-spinner" /><p>{t('booking_map_loading')}</p></>
        : <><i className="ri-map-2-line" aria-hidden="true" /><p>{t('booking_map_error')}</p>
          <button type="button" className="booking-secondary" onClick={() => setRetry(n => n + 1)}>{t('booking_retry')}</button></>}
    </div>}
  </>;
}
