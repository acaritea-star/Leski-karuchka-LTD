import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { freshFix, validFix, type VehicleFix } from '@/lib/vehicleMotion';
import { withRequestTimeout } from '@/lib/requestTimeout';

export function driverPosition(row: Record<string, unknown>): VehicleFix | null {
  if (typeof row.latitude !== 'number' || typeof row.longitude !== 'number') return null;
  const timestamp = Date.parse(typeof row.position_at === 'string' ? row.position_at : String(row.updated_at ?? ''));
  const receivedAt = Date.parse(String(row.updated_at ?? ''));
  const fix: VehicleFix = { lat: row.latitude, lng: row.longitude, timestamp,
    receivedAt: Number.isFinite(receivedAt) ? receivedAt : undefined,
    heading: typeof row.heading === 'number' ? row.heading : null,
    speed: typeof row.speed === 'number' ? row.speed : null,
    accuracy: typeof row.accuracy === 'number' ? row.accuracy : null };
  return validFix(fix) && timestamp <= Date.now() + 30_000 ? fix : null;
}

export function useDriverPosition(driverId: string | null | undefined, enabled = true): VehicleFix | null {
  const [fix, setFix] = useState<VehicleFix | null>(null);
  useEffect(() => {
    setFix(null);
    if (!driverId || !enabled) return;
    let active = true, reading = false, failures = 0, nextAttempt = 0;
    const controller = new AbortController();
    const apply = (row: Record<string, unknown>) => {
      const next = driverPosition(row);
      if (!active || !next) return;
      // A late poll response cannot rewind a newer Realtime GPS fix. A server
      // heartbeat with the same position_at also cannot restart the animation.
      setFix(previous => previous && previous.timestamp >= next.timestamp ? previous : next);
    };
    const poll = async () => {
      if (!active || reading || Date.now() < nextAttempt || document.visibilityState === 'hidden') return;
      reading = true;
      try {
        const { data, error } = await withRequestTimeout(signal => supabase.from('driver_locations')
          .select('latitude, longitude, heading, speed, accuracy, position_at, updated_at')
          .eq('driver_id', driverId).abortSignal(signal).maybeSingle(), 10_000, controller.signal);
        if (error) throw error;
        failures = 0; nextAttempt = 0;
        if (data) apply(data);
      } catch {
        // Retain the last fix until its original timestamp expires. A failed
        // connection must not turn the fallback poll into a retry storm.
        nextAttempt = Date.now() + Math.min(30_000, 5000 * 2 ** Math.min(failures++, 3));
      }
      finally { reading = false; }
    };
    const run = () => { void poll(); };
    const resume = () => { if (document.visibilityState !== 'hidden') { nextAttempt = 0; run(); } };
    run();
    const channel = supabase.channel(`map-position-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        payload => apply(payload.new as Record<string, unknown>))
      .subscribe(status => { if (status === 'SUBSCRIBED') resume(); });
    const timer = setInterval(run, 5000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    return () => {
      active = false; controller.abort(); clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      void supabase.removeChannel(channel);
    };
  }, [driverId, enabled]);
  return fix;
}

export function usePositionFreshness(fix: VehicleFix | null): boolean {
  const [fresh, setFresh] = useState(() => freshFix(fix));
  useEffect(() => {
    const update = () => setFresh(freshFix(fix));
    update();
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [fix]);
  return fresh && freshFix(fix);
}
