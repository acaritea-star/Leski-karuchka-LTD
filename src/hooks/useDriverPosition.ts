import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { freshFix, validFix, type VehicleFix } from '@/lib/vehicleMotion';
import { createRealtimePoll } from '@/lib/realtimePoll';

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

export function useDriverPosition(driverId: string | null | undefined, enabled = true, scope?: string): VehicleFix | null {
  const [state, setState] = useState<{ driverId: typeof driverId; scope?: string; fix: VehicleFix | null } | null>(null);
  useEffect(() => {
    setState(null);
    if (!driverId || !enabled) return;
    let active = true;
    let revision = 0;
    const apply = (row: Record<string, unknown>) => {
      const next = driverPosition(row);
      if (!active || !next) return;
      // A late poll response cannot rewind a newer Realtime GPS fix. A server
      // heartbeat with the same position_at also cannot restart the animation.
      setState(previous => previous?.fix && previous.fix.timestamp >= next.timestamp ? previous : { driverId, scope, fix: next });
    };
    const poll = createRealtimePoll(async signal => {
        const started = revision;
        const { data, error } = await supabase.from('driver_locations')
          .select('latitude, longitude, heading, speed, accuracy, position_at, updated_at')
          .eq('driver_id', driverId).abortSignal(signal).maybeSingle();
        if (error) throw error;
        return { data, started };
    }, ({ data, started }) => {
      if (data) apply(data);
      // An authoritative empty read revokes the displayed location. A read
      // begun before a new Realtime fix cannot erase that newer confirmation.
      else if (active && started === revision) setState(null);
    }, { healthyMs: 15_000, metric: 'tracking.read' });
    const channel = supabase.channel(`map-position-${driverId}`)
      .on('system', {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension === 'postgres_changes') poll.setStatus(payload.status === 'ok' ? 'SUBSCRIBED' : 'CHANNEL_ERROR');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_locations', filter: `driver_id=eq.${driverId}` },
        payload => {
          if (!active || !driverPosition(payload.new as Record<string, unknown>)) return;
          revision++; apply(payload.new as Record<string, unknown>);
          poll.setStatus('SUBSCRIBED');
        })
      .subscribe(status => {
        // Older SDKs acknowledge the socket before Postgres is listening.
        // Use the fast fallback until the system confirmation or a real fix.
        if (status !== 'SUBSCRIBED') poll.setStatus(status);
      });
    return () => {
      active = false; poll.stop();
      void supabase.removeChannel(channel);
    };
  }, [driverId, enabled, scope]);
  return enabled && state && state.driverId === driverId && state.scope === scope ? state.fix : null;
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
