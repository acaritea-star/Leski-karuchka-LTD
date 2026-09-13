/* global google */
import { useEffect, useRef, useState, useCallback } from 'react';
import { computeRoute, decodePolyline, type RouteResult } from '@/lib/googleMaps';
import { BULGARIA_CENTER } from '@/lib/geo';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';

export interface BookingMapLocation {
  address: string;
  lat: number;
  lng: number;
}

interface BookingMapProps {
  pickup: BookingMapLocation | null;
  destination: BookingMapLocation | null;
}

// Default view shows the whole country; zooms in once a location is picked.
const DEFAULT_CENTER = { lat: BULGARIA_CENTER.lat, lng: BULGARIA_CENTER.lng };
const DEFAULT_ZOOM = 7;
const USER_ZOOM = 15;

// Brand marker colours (map overlays)
const PICKUP_COLOR = '#2d7a5e'; // accent green — "start"
const DEST_COLOR = '#1a1a1a'; // dark — "destination"
const ACCENT_COLOR = '#2d7a5e'; // route accent
const USER_COLOR = '#2563eb'; // blue — the user's live position

function letterIcon(letter: string, bg: string, round: boolean): google.maps.Icon {
  const rx = round ? '13' : '6';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">' +
    `<rect x="2" y="2" width="26" height="26" rx="${rx}" fill="${bg}" stroke="#ffffff" stroke-width="3"/>` +
    `<text x="15" y="21" text-anchor="middle" font-family="Manrope, Arial, sans-serif" font-size="14" font-weight="700" fill="#ffffff">${letter}</text></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(30, 30),
    anchor: new google.maps.Point(15, 15),
  };
}

function userDotIcon(): google.maps.Icon {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22">' +
    '<circle cx="11" cy="11" r="10" fill="#2563eb" fill-opacity="0.22"/>' +
    '<circle cx="11" cy="11" r="5.5" fill="#2563eb" stroke="#ffffff" stroke-width="2.5"/></svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(22, 22),
    anchor: new google.maps.Point(11, 11),
  };
}

export default function BookingMap({ pickup, destination }: BookingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const pickupMarkerRef = useRef<google.maps.Marker | null>(null);
  const destMarkerRef = useRef<google.maps.Marker | null>(null);
  const userMarkerRef = useRef<google.maps.Marker | null>(null);
  const routeCasingRef = useRef<google.maps.Polyline | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteResult | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Latest values mirrored into refs so the async map init can read them
  const pickupRef = useRef(pickup);
  const destRef = useRef(destination);
  const routeInfoRef = useRef(routeInfo);
  const userLocationRef = useRef(userLocation);
  pickupRef.current = pickup;
  destRef.current = destination;
  routeInfoRef.current = routeInfo;
  userLocationRef.current = userLocation;

  // Detect the user's current position so the map opens on them (not the whole world)
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled) return;
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        /* permission denied — fall back to country view */
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const clearLayers = useCallback(() => {
    if (pickupMarkerRef.current) {
      pickupMarkerRef.current.setMap(null);
      pickupMarkerRef.current = null;
    }
    if (destMarkerRef.current) {
      destMarkerRef.current.setMap(null);
      destMarkerRef.current = null;
    }
    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }
    if (routeCasingRef.current) {
      routeCasingRef.current.setMap(null);
      routeCasingRef.current = null;
    }
    if (routeRef.current) {
      routeRef.current.setMap(null);
      routeRef.current = null;
    }
  }, []);

  const syncLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const pu = pickupRef.current;
    const dest = destRef.current;
    const route = routeInfoRef.current;
    const user = userLocationRef.current;

    clearLayers();

    const points: google.maps.LatLngLiteral[] = [];

    if (pu) {
      pickupMarkerRef.current = new google.maps.Marker({
        position: { lat: pu.lat, lng: pu.lng },
        map,
        zIndex: 100,
        icon: letterIcon('A', PICKUP_COLOR, true),
      });
      points.push({ lat: pu.lat, lng: pu.lng });
    }

    if (dest) {
      destMarkerRef.current = new google.maps.Marker({
        position: { lat: dest.lat, lng: dest.lng },
        map,
        zIndex: 90,
        icon: letterIcon('B', DEST_COLOR, false),
      });
      points.push({ lat: dest.lat, lng: dest.lng });
    }

    // Show the user's own blue dot only when no pickup is chosen yet
    // (the auto-detected pickup already sits on this exact position).
    if (user && !pu) {
      userMarkerRef.current = new google.maps.Marker({
        position: { lat: user.lat, lng: user.lng },
        map,
        zIndex: 80,
        icon: userDotIcon(),
      });
    }

    if (route?.polyline && pu && dest) {
      try {
        const decoded = decodePolyline(route.polyline);
        const path = decoded.map((p) => ({ lat: p.lat, lng: p.lng }));

        routeCasingRef.current = new google.maps.Polyline({
          path,
          map,
          strokeColor: 'rgba(255,255,255,0.92)',
          strokeWeight: 7,
          strokeOpacity: 1,
        });

        routeRef.current = new google.maps.Polyline({
          path,
          map,
          strokeColor: ACCENT_COLOR,
          strokeWeight: 3.5,
          strokeOpacity: 0.9,
        });

        points.push(...path);
      } catch {
        /* fall through to the straight fallback line below */
      }
    } else if (pu && dest) {
      routeRef.current = new google.maps.Polyline({
        path: [
          { lat: pu.lat, lng: pu.lng },
          { lat: dest.lat, lng: dest.lng },
        ],
        map,
        strokeColor: ACCENT_COLOR,
        strokeWeight: 3,
        strokeOpacity: 0.55,
      });
    }

    if (points.length > 0) {
      if (points.length === 1) {
        map.setZoom(16);
        map.panTo(points[0]);
      } else {
        const bounds = new google.maps.LatLngBounds();
        points.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 40);
      }
    } else if (user) {
      map.setZoom(USER_ZOOM);
      map.panTo({ lat: user.lat, lng: user.lng });
    } else {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(DEFAULT_ZOOM);
    }
  }, [clearLayers]);

  // Initialise the Google map once
  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || mapRef.current) return;
        const map = new google.maps.Map(el, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          zoomControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;
        syncLayers();
      })
      .catch((err) => {
        console.error('[BookingMap] init error:', err);
      });

    return () => {
      cancelled = true;
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
    };
  }, [syncLayers]);

  // Fetch the real driving route from the Google Routes API
  useEffect(() => {
    if (!pickup || !destination) {
      setRouteInfo(null);
      return;
    }
    let active = true;
    computeRoute(
      { lat: pickup.lat, lng: pickup.lng },
      { lat: destination.lat, lng: destination.lng },
      { travelMode: 'DRIVE', language: 'bg', units: 'METRIC' },
    )
      .then((res) => {
        if (active && res?.success) {
          setRouteInfo(res);
        }
      })
      .catch((err) => {
        console.error('[BookingMap] computeRoute error:', err);
      });
    return () => {
      active = false;
    };
  }, [pickup, destination]);

  // Re-sync markers / route / bounds whenever inputs change
  useEffect(() => {
    syncLayers();
  }, [pickup, destination, routeInfo, userLocation, syncLayers]);

  return <div ref={containerRef} className="absolute inset-0 z-0" />;
}