/* global google */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { BULGARIA_CENTER } from '@/lib/geo';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { drawRouteLine, mapPinIcon, type RouteLine } from '@/lib/mapLayers';
import type { BookingLocation } from './BookingCard';

export default function BookingMap({ pickup, destination, route }: {
  pickup: BookingLocation | null; destination: BookingLocation | null; route: RouteResult | null;
}) {
  const { t } = useTranslation();
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setState('loading');
    loadGoogleMaps().then(() => {
      if (!active || !container.current) return;
      map.current = new google.maps.Map(container.current, {
        center: BULGARIA_CENTER, zoom: 7, disableDefaultUI: true, gestureHandling: 'greedy',
        clickableIcons: false, styles: [
          { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9dedc' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f0f1e9' }] },
          { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#dce8d4' }] },
        ],
      });
      setState('ready');
    }).catch(() => { if (active) setState('error'); });
    return () => {
      active = false;
      if (map.current) google.maps.event.clearInstanceListeners(map.current);
      map.current = null;
    };
  }, [retry]);

  // Display the quoted route from the parent; do not make a second Routes API request.
  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap || state !== 'ready') return;
    const layers: Array<google.maps.Marker | google.maps.Polyline> = [];
    const points: google.maps.LatLngLiteral[] = [];
    let routeLine: RouteLine | null = null;
    [pickup, destination].forEach((location, index) => {
      if (!location) return;
      points.push(location);
      layers.push(new google.maps.Marker({ map: currentMap, position: location,
        title: location.address, zIndex: 1100, icon: mapPinIcon(index === 0 ? 'pickup' : 'destination') }));
    });
    if (pickup && destination && route?.polyline) {
      const path = decodePolyline(route.polyline);
      points.push(...path);
      if (path.length >= 2) routeLine = drawRouteLine(currentMap, path);
    }
    const fit = () => {
      if (!points.length) return;
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      const bounds = new google.maps.LatLngBounds();
      points.forEach(point => bounds.extend(point));
      currentMap.fitBounds(bounds, { top: 94, bottom: 38, left: desktop ? 462 : 38, right: 38 });
      if (points.length === 1) currentMap.setZoom(16);
    };
    fit();
    const resize = new ResizeObserver(fit);
    if (container.current) resize.observe(container.current);
    return () => { resize.disconnect(); routeLine?.remove(); layers.forEach(layer => layer.setMap(null)); };
  }, [pickup, destination, route, state]);

  return <>
    <div ref={container} className="absolute inset-0" aria-label={t('trip_route')} />
    {state !== 'ready' && <div className="booking-map-state" role="status">
      {state === 'loading' ? <><span className="booking-spinner" /><p>{t('booking_map_loading')}</p></>
        : <><i className="ri-map-2-line" aria-hidden="true" /><p>{t('booking_map_error')}</p>
          <button type="button" className="booking-secondary" onClick={() => setRetry(n => n + 1)}>{t('booking_retry')}</button></>}
    </div>}
  </>;
}
