import type { RoadMatch, RoadNetwork } from '@/lib/roadNetwork';
/* global google */
import { useEffect, useRef } from 'react';
import type { RoutePoint } from '@/lib/googleMaps';
import { mapCarSymbol, MAP_CAR_COLOR } from '@/lib/mapLayers';
import { distanceMetres, matchRoute, measureRoute } from '@/lib/routeGeometry';
import { VehicleMotion, type VehicleFix, type VehicleFrame } from '@/lib/vehicleMotion';

// Frame updates go directly to Maps; React, route requests and database writes
// only see actual GPS fixes, never these presentation coordinates.
export function useVehicleMarker(map: google.maps.Map | null, fix: VehicleFix | null,
  path: readonly RoutePoint[], color = MAP_CAR_COLOR, onFrame?: (frame: VehicleFrame) => void, roads?: RoadNetwork | null, requireRoad = false, animationWindowMs = 5000) {
  const motion = useRef(new VehicleMotion(animationWindowMs));
  const frameRef = useRef<VehicleFrame | null>(null);
  const latest = useRef({ fix, path, color, onFrame, roads, requireRoad });
  latest.current = { fix, path, color, onFrame, roads, requireRoad };
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!map) return;
    motion.current = new VehicleMotion(animationWindowMs);
    motion.current.setRoute(latest.current.path);
    let appliedPath = latest.current.path;
    let matchedRoad: RoadMatch | undefined;
    let lastSourceTime: number | undefined;
    let marker: google.maps.Marker | null = null;
    let animation: number | null = null;
    let paintedHeading: number | null = null;
    let paintedColor: string | null = null;
    let clock = { epoch: Date.now(), frame: performance.now() };
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cancel = () => { if (animation !== null) cancelAnimationFrame(animation); animation = null; };
    const paint = (timestamp = performance.now()) => {
      const frame = motion.current.sample(clock.epoch + Math.max(0, timestamp - clock.frame));
      if (!frame) return;
      frameRef.current = frame;
      const position = { lat: frame.lat, lng: frame.lng };
      const color = latest.current.color;
      if (!marker) {
        marker = new google.maps.Marker({ map, position, icon: mapCarSymbol(frame.heading, color), zIndex: 1000, title: 'Шофьор' });
        paintedHeading = frame.heading; paintedColor = color;
      } else {
        marker.setPosition(position);
        const turn = paintedHeading == null ? Infinity : Math.abs(((frame.heading - paintedHeading + 540) % 360) - 180);
        if (turn >= .5 || color !== paintedColor) {
          marker.setIcon(mapCarSymbol(frame.heading, color));
          paintedHeading = frame.heading; paintedColor = color;
        }
      }
      latest.current.onFrame?.(frame);
      if (frame.moving && document.visibilityState !== 'hidden' && !media.matches) animation = requestAnimationFrame(paint);
      else animation = null;
    };
    const draw = () => {
      cancel();
      const next = latest.current.fix;
      if (!next) {
        marker?.setMap(null); marker = null; frameRef.current = null;
        motion.current = new VehicleMotion(animationWindowMs); motion.current.setRoute(latest.current.path);
        appliedPath = latest.current.path; lastSourceTime = undefined; matchedRoad = undefined;
        return;
      }
      clock = { epoch: Date.now(), frame: performance.now() };
      let displayed = next;
      const network = latest.current.roads;
      let path = latest.current.path;
      let instant = false;
      const limit = Math.min(65, Math.max(25, (next.accuracy ?? 10) * 1.5));
      const planned = matchRoute(next, measureRoute(path));
      // The driver's navigation is authoritative when GPS is close to it.
      // Street geometry is a fallback, never a competing parallel route.
      if (!planned || planned.distance > limit) {
        const heading = (next.speed ?? 0) >= 1.5 ? next.heading ?? frameRef.current?.heading : frameRef.current?.heading;
        const match = network?.match(next, heading, matchedRoad);
        if (match && match.distance <= limit && network) {
          const previous = frameRef.current ? network.match(frameRef.current, frameRef.current.heading, matchedRoad) : null;
          const connection = previous ? network.path(previous, match) : null;
          path = connection ?? [match.point];
          // Disconnected streets/gaps must not animate a chord through buildings.
          instant = !connection;
          displayed = { ...next, ...match.point, heading: match.heading };
          matchedRoad = match;
        } else if (latest.current.requireRoad) {
          marker?.setMap(null); marker = null; return;
        }
      }
      const geometryChanged = path !== appliedPath;
      if (geometryChanged) {
        // A delayed road response may arrive with the same GPS timestamp.
        // Resnap only that presentation; ordinary heartbeat duplicates stay ignored.
        const frame = frameRef.current;
        const onNewRoad = frame ? matchRoute(frame, measureRoute(path)) : null;
        const needsResnap = !!frame && (onNewRoad ? onNewRoad.distance > .7 : distanceMetres(frame, displayed) > .7);
        if (next.timestamp === lastSourceTime && needsResnap) { motion.current = new VehicleMotion(animationWindowMs); instant = true; }
        motion.current.setRoute(path); appliedPath = path;
      }
      if (motion.current.update(displayed, clock.epoch, instant || media.matches || document.visibilityState === 'hidden')) lastSourceTime = next.timestamp;
      paint();
    };
    const resync = () => {
      cancel();
      motion.current.settle();
      if (document.visibilityState !== 'hidden') draw();
    };
    drawRef.current = draw;
    draw();
    document.addEventListener('visibilitychange', resync);
    media.addEventListener('change', resync);
    return () => {
      cancel(); drawRef.current = () => {};
      document.removeEventListener('visibilitychange', resync);
      media.removeEventListener('change', resync);
      marker?.setMap(null);
      frameRef.current = null;
    };
  }, [map, animationWindowMs]);

  useEffect(() => { drawRef.current(); }, [fix, color, path, roads]);
  return frameRef;
}
