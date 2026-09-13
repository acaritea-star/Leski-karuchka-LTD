/* global google */
import { useEffect, useRef, useState, useCallback } from 'react';
import { loadGoogleMaps } from '@/lib/googleMapsLoader';
import { computeRoute, decodePolyline } from '@/lib/googleMaps';
import { supabase } from '@/lib/supabase';

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
  onNavInfo?: (info: NavInfo | null) => void;
}

const ROUTE_COLOR = '#2d7a5e';
const CAR_COLOR = '#0d9488';

function carSymbol(heading: number): google.maps.Symbol {
  return {
    path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
    rotation: heading,
    scale: 5,
    fillColor: CAR_COLOR,
    fillOpacity: 1,
    strokeColor: '#ffffff',
    strokeWeight: 2,
  };
}

function targetIcon(): google.maps.Icon {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    '<circle cx="12" cy="12" r="10" fill="#1a1a1a" stroke="#ffffff" stroke-width="3"/></svg>';
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(24, 24),
    anchor: new google.maps.Point(12, 12),
  };
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function degDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  // Rough metres per degree at mid-latitudes (~43°N)
  const dy = (lat2 - lat1) * 111_000;
  const dx = (lng2 - lng1) * 111_000 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * In-app navigation map for the driver.
 * Shows live GPS position, the target (pickup or destination), the real driving
 * route, and turn-by-turn instructions — no external Google Maps redirect.
 */
export default function DriverRouteMap({ targetLat, targetLng, driverId, onNavInfo }: DriverRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const carMarkerRef = useRef<google.maps.Marker | null>(null);
  const targetMarkerRef = useRef<google.maps.Marker | null>(null);
  const routeRef = useRef<google.maps.Polyline | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const targetRef = useRef({ lat: targetLat, lng: targetLng });
  const lastPosRef = useRef<{ lat: number; lng: number; heading: number } | null>(null);
  const lastPanRef = useRef(0);
  const lastRouteFetchRef = useRef({ lat: 0, lng: 0, at: 0 });
  const gpsFailedRef = useRef(false);
  const navInfoSentRef = useRef<NavInfo | null>(null);

  const [pos, setPos] = useState<{ lat: number; lng: number; heading: number } | null>(null);
  const [routePath, setRoutePath] = useState<{ lat: number; lng: number }[] | null>(null);
  const [navInfo, setNavInfo] = useState<NavInfo | null>(null);
  const [routeError, setRouteError] = useState(false);

  // Throttled onNavInfo callback (only when values materially change)
  const throttledOnNavInfo = useCallback((info: NavInfo | null) => {
    if (!onNavInfo) return;
    const last = navInfoSentRef.current;
    if (
      last &&
      info &&
      Math.abs(last.distance_km - info.distance_km) < 0.3 &&
      Math.abs(last.duration_min - info.duration_min) < 1 &&
      last.instruction === info.instruction
    ) {
      return;
    }
    navInfoSentRef.current = info;
    onNavInfo(info);
  }, [onNavInfo]);

  // ── Initialise the map once (never re-create on prop changes) ──
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || mapRef.current) return;
        const map = new google.maps.Map(el, {
          center: { lat: targetRef.current.lat, lng: targetRef.current.lng },
          zoom: 15,
          disableDefaultUI: true,
          gestureHandling: 'greedy',
          zoomControl: false,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;

        targetMarkerRef.current = new google.maps.Marker({
          position: { lat: targetRef.current.lat, lng: targetRef.current.lng },
          map,
          icon: targetIcon(),
          zIndex: 100,
        });
      })
      .catch(() => {
        /* ignore */
      });

    return () => {
      cancelled = true;
      if (carMarkerRef.current) { carMarkerRef.current.setMap(null); carMarkerRef.current = null; }
      if (targetMarkerRef.current) { targetMarkerRef.current.setMap(null); targetMarkerRef.current = null; }
      if (routeRef.current) { routeRef.current.setMap(null); routeRef.current = null; }
      if (mapRef.current) {
        google.maps.event.clearInstanceListeners(mapRef.current);
        mapRef.current = null;
      }
    };
  }, []);

  // ── Update target marker / centre when the target changes ──
  useEffect(() => {
    targetRef.current = { lat: targetLat, lng: targetLng };
    // Force a fresh route fetch the moment the target switches (pickup → destination)
    lastRouteFetchRef.current = { lat: 0, lng: 0, at: 0 };
    const map = mapRef.current;
    if (!map) return;
    map.setCenter({ lat: targetLat, lng: targetLng });
    if (targetMarkerRef.current) {
      targetMarkerRef.current.setPosition({ lat: targetLat, lng: targetLng });
    }
  }, [targetLat, targetLng]);

  // ── Live GPS tracking — throttle setPos to > 50 m moves ──
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      gpsFailedRef.current = true;
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (p) => {
        gpsFailedRef.current = false;
        const newPos = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          heading: p.coords.heading ?? 0,
        };
        const last = lastPosRef.current;
        if (last && degDistance(last.lat, last.lng, newPos.lat, newPos.lng) < 50) {
          // Too small to matter — update marker directly without React re-render
          const map = mapRef.current;
          if (carMarkerRef.current && map) {
            carMarkerRef.current.setPosition({ lat: newPos.lat, lng: newPos.lng });
            carMarkerRef.current.setIcon(carSymbol(newPos.heading));
            const now = Date.now();
            if (now - lastPanRef.current > 1000) {
              map.panTo({ lat: newPos.lat, lng: newPos.lng });
              lastPanRef.current = now;
            }
          }
          lastPosRef.current = newPos;
          return;
        }
        lastPosRef.current = newPos;
        setPos(newPos);
      },
      () => {
        gpsFailedRef.current = true;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 2000 },
    );
    return () => {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // ── Fallback: read the last known location from the DB if GPS has no fix ──
  useEffect(() => {
    if (!driverId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('driver_locations')
          .select('latitude, longitude, heading')
          .eq('driver_id', driverId)
          .maybeSingle();
        if (data && !cancelled && gpsFailedRef.current) {
          const newPos = { lat: data.latitude, lng: data.longitude, heading: data.heading ?? 0 };
          const last = lastPosRef.current;
          if (!last || degDistance(last.lat, last.lng, newPos.lat, newPos.lng) >= 50) {
            lastPosRef.current = newPos;
            setPos(newPos);
          }
        }
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [driverId]);

  // ── Update the car marker + keep the driver centred (throttled) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pos) return;

    if (!carMarkerRef.current) {
      carMarkerRef.current = new google.maps.Marker({
        position: { lat: pos.lat, lng: pos.lng },
        map,
        icon: carSymbol(pos.heading),
        zIndex: 1000,
      });

      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: pos.lat, lng: pos.lng });
      bounds.extend({ lat: targetRef.current.lat, lng: targetRef.current.lng });
      map.fitBounds(bounds, 60);
    } else {
      carMarkerRef.current.setPosition({ lat: pos.lat, lng: pos.lng });
      carMarkerRef.current.setIcon(carSymbol(pos.heading));
      const now = Date.now();
      if (now - lastPanRef.current > 1000) {
        map.panTo({ lat: pos.lat, lng: pos.lng });
        lastPanRef.current = now;
      }
    }
  }, [pos]);

  // ── Fetch the real driving route (throttled: 120 m or 60 s) ──
  useEffect(() => {
    if (!pos) return;
    const now = Date.now();
    const last = lastRouteFetchRef.current;
    const moved =
      Math.abs(last.lat - pos.lat) > 0.0011 || Math.abs(last.lng - pos.lng) > 0.0011; // ~120 m
    const stale = now - last.at > 60000; // 60 s
    if (!moved && !stale) return;

    lastRouteFetchRef.current = { lat: pos.lat, lng: pos.lng, at: now };
    let active = true;
    computeRoute(
      { lat: pos.lat, lng: pos.lng },
      { lat: targetRef.current.lat, lng: targetRef.current.lng },
      { travelMode: 'DRIVE', language: 'bg', units: 'METRIC' },
    )
      .then((res) => {
        if (!active) return;
        if (res?.success) {
          try {
            const pts = decodePolyline(res.polyline).map((p) => ({ lat: p.lat, lng: p.lng }));
            if (pts.length >= 2) setRoutePath(pts);
          } catch {
            /* ignore */
          }
          const firstStep = res.legs?.[0]?.steps?.[0];
          const nextInfo: NavInfo = {
            distance_km: res.distance_km,
            duration_min: res.duration_min,
            instruction: firstStep?.instruction
              ? stripHtml(firstStep.instruction)
              : null,
            next_step_meters: firstStep?.distance_meters ?? null,
          };
          setNavInfo(nextInfo);
          throttledOnNavInfo(nextInfo);
          setRouteError(false);
        } else {
          setRouteError(true);
        }
      })
      .catch(() => {
        if (active) setRouteError(true);
      });
    return () => {
      active = false;
    };
  }, [pos, targetLat, targetLng, throttledOnNavInfo]);

  // ── Draw / update the route polyline ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routePath) return;
    if (!routeRef.current) {
      routeRef.current = new google.maps.Polyline({
        path: routePath,
        map,
        strokeColor: ROUTE_COLOR,
        strokeWeight: 5,
        strokeOpacity: 0.85,
      });
    } else {
      routeRef.current.setPath(routePath);
    }
  }, [routePath]);

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Turn-by-turn banner */}
      {navInfo?.instruction && (
        <div className="absolute top-2 left-2 right-2 z-10 bg-white/95 backdrop-blur rounded-xl px-3 py-2 border border-background-100 flex items-center gap-2">
          <span className="w-8 h-8 rounded-full bg-accent-100 flex items-center justify-center flex-shrink-0">
            <i className="ri-navigation-fill text-accent-600 text-base" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground-950 leading-tight truncate">
              {navInfo.instruction}
            </p>
            {navInfo.next_step_meters != null && (
              <p className="text-[11px] text-foreground-500">
                след {Math.round(navInfo.next_step_meters)} м
              </p>
            )}
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-sm font-bold text-foreground-950 font-heading leading-none">
              {navInfo.duration_min}<span className="text-[10px] font-normal text-foreground-500"> мин</span>
            </p>
            <p className="text-[10px] text-foreground-500 mt-0.5">{navInfo.distance_km.toFixed(1)} км</p>
          </div>
        </div>
      )}

      {/* Route unavailable warning */}
      {routeError && !navInfo?.instruction && (
        <div className="absolute bottom-2 left-2 right-2 z-10 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center">
          <p className="text-xs text-amber-700 font-medium">
            Маршрутът не можа да бъде изчислен. Провери връзката с интернет.
          </p>
        </div>
      )}
    </div>
  );
}