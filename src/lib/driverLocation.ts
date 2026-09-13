import { supabase } from '@/lib/supabase';

export const GPS_HEARTBEAT_MS = 15_000;
export const GPS_STALE_MS = 45_000;
const MOVING_INTERVAL_MS = 5_000;
let generation = 0;
let watchId: number | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastFixAt = 0;
let lastWriteAt = 0;
let lastError = '';
let stopListeners: (() => void) | null = null;

type Callbacks = { onUpdate?: () => void; onError?: (message: string) => void };

export function isFreshTimestamp(value: string | null | undefined, now = Date.now()): boolean {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time <= now + 30_000 && now - time < GPS_STALE_MS;
}
export function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Браузърът не поддържа GPS.'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
  });
}
export async function saveDriverPosition(id: string, company: string, position: GeolocationPosition): Promise<string> {
  if (Date.now() - position.timestamp > 30_000 || position.timestamp > Date.now() + 30_000) throw new Error('GPS позицията е остаряла.');
  if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy > 1000) throw new Error('Неточна GPS позиция. Изчакай по-добър сигнал.');
  const { data, error } = await supabase.from('driver_locations').upsert({
    driver_id: id, company_id: company,
    latitude: position.coords.latitude, longitude: position.coords.longitude,
    heading: position.coords.heading, speed: position.coords.speed, accuracy: position.coords.accuracy,
    position_at: new Date(position.timestamp).toISOString(),
  }, { onConflict: 'driver_id' }).select('updated_at').abortSignal(AbortSignal.timeout(10_000)).single();
  if (error) throw new Error(error.message);
  if (!data?.updated_at) throw new Error('Локацията не е потвърдена от сървъра.');
  return data.updated_at;
}
export async function setDriverOnline(driver: { id: string; company_id: string }, online: boolean) {
  if (online) await saveDriverPosition(driver.id, driver.company_id, await getCurrentPosition());
  const { data, error } = await supabase.from('drivers').update({ is_online: online })
    .eq('id', driver.id).select('id').single();
  if (error || !data) throw new Error(error?.message ?? 'Промяната не е потвърдена.');
  if (!online) stopDriverGps();
}
export function startDriverGps(id: string, company: string, callbacks: Callbacks = {}): boolean {
  stopDriverGps();
  if (!navigator.geolocation) { callbacks.onError?.('Браузърът не поддържа GPS.'); return false; }
  const run = generation;
  let writing = false;
  let locating = false;
  const fail = (error: unknown) => {
    if (run !== generation) return;
    lastError = error && typeof error === 'object' && 'code' in error && error.code === 1
      ? 'Разреши достъп до местоположението от настройките.'
      : error instanceof Error ? error.message : 'GPS или връзката е прекъсната. Провери локацията и интернета.';
    callbacks.onError?.(lastError);
  };
  const push = async (position: GeolocationPosition, force = false) => {
    if (run !== generation) return;
    lastFixAt = position.timestamp;
    if (writing || (!force && Date.now() - lastWriteAt < MOVING_INTERVAL_MS)) return;
    writing = true;
    try {
      const savedAt = await saveDriverPosition(id, company, position);
      if (run !== generation) return;
      lastWriteAt = Date.parse(savedAt);
      lastError = '';
      callbacks.onUpdate?.();
    } catch (error) { fail(error); }
    finally { writing = false; }
  };
  const refresh = async () => {
    if (run !== generation || document.visibilityState === 'hidden' || locating) return;
    locating = true;
    try { await push(await getCurrentPosition(), true); }
    catch (error) { fail(error); }
    finally { locating = false; }
  };
  watchId = navigator.geolocation.watchPosition(position => void push(position), fail,
    { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  heartbeat = setInterval(() => void refresh(), GPS_HEARTBEAT_MS);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);
  stopListeners = () => {
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('online', refresh);
  };
  return true;
}
export function stopDriverGps() {
  generation++;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  if (heartbeat) clearInterval(heartbeat);
  stopListeners?.();
  stopListeners = null; watchId = null; heartbeat = null;
  lastFixAt = 0; lastWriteAt = 0; lastError = '';
}
export function isDriverGpsRunning() { return watchId !== null; }
export function getGpsStats() {
  return { running: isDriverGpsRunning(), lastFixAgeMs: Date.now() - lastFixAt,
    lastWriteAgeMs: Date.now() - lastWriteAt, error: lastError };
}
