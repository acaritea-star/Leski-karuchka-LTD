/* global google */
import { useEffect, useRef } from 'react';
import type { RoutePoint } from '@/lib/googleMaps';
import { mapCarSymbol, MAP_CAR_COLOR } from '@/lib/mapLayers';
import { VehicleMotion, type VehicleFix, type VehicleFrame } from '@/lib/vehicleMotion';

// Frame updates go directly to Maps; React, route requests and database writes
// only see actual GPS fixes, never these presentation coordinates.
export function useVehicleMarker(map: google.maps.Map | null, fix: VehicleFix | null,
  path: readonly RoutePoint[], color = MAP_CAR_COLOR, onFrame?: (frame: VehicleFrame) => void) {
  const motion = useRef(new VehicleMotion());
  const frameRef = useRef<VehicleFrame | null>(null);
  const latest = useRef({ fix, path, color, onFrame });
  latest.current = { fix, path, color, onFrame };
  const drawRef = useRef<() => void>(() => {});

  useEffect(() => { motion.current.setRoute(path); }, [path]);
  useEffect(() => {
    if (!map) return;
    motion.current = new VehicleMotion();
    motion.current.setRoute(latest.current.path);
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
        motion.current = new VehicleMotion(); motion.current.setRoute(latest.current.path);
        return;
      }
      clock = { epoch: Date.now(), frame: performance.now() };
      motion.current.update(next, clock.epoch, media.matches || document.visibilityState === 'hidden');
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
  }, [map]);

  useEffect(() => { drawRef.current(); }, [fix, color]);
  return frameRef;
}
