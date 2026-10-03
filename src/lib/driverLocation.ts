import { isInBulgaria, SERVICE_AREA_ERROR } from './serviceArea';
import { supabase } from '@/lib/supabase';
import { requestGps, subscribeGps } from './sharedGps';
import { getLocationEnabled, setLocationEnabled } from './locationPreference';

export const GPS_HEARTBEAT_MS = 15_000;
export const GPS_STALE_MS = 45_000;
export const GPS_MAX_ACCURACY_METERS = 100;
const MOVING_INTERVAL_MS = 5_000;
let generation = 0;
let unsubscribeGps: (() => void) | null = null;
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
  return requestGps();
}
export async function saveDriverPosition(id: string, company: string, position: GeolocationPosition): Promise<string> {
  if (Date.now() - position.timestamp > 30_000 || position.timestamp > Date.now() + 30_000) throw new Error('GPS позицията е остаряла.');
  if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > GPS_MAX_ACCURACY_METERS) throw new Error('Неточна GPS позиция. Изчакай по-добър сигнал.');
  if (!isInBulgaria(position.coords.latitude, position.coords.longitude)) throw new Error(SERVICE_AREA_ERROR);
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
export async function setDriverOnline(driver: { id: string; company_id: string; user_id?: string }, online: boolean) {
  if (online) {
    const position = await getCurrentPosition();
    await saveDriverPosition(driver.id, driver.company_id, position);
  }
  const { data, error } = await supabase.from('drivers').update({ is_online: online })
    .eq('id', driver.id).select('*').abortSignal(AbortSignal.timeout(10_000)).single();
  if (error || !data) throw new Error(error?.message ?? 'Промяната не е потвърдена.');
  if (online && driver.user_id) setLocationEnabled(driver.user_id, true);
  if (!online) stopDriverGps();
  return data;
}
export function startDriverGps(id: string, company: string, callbacks: Callbacks = {}, userId?: string): boolean {
  stopDriverGps();
  if (getLocationEnabled(userId) === false) { callbacks.onError?.('Местоположението е изключено от настройките.'); return false; }
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
  unsubscribeGps = subscribeGps(position => void push(position), fail);
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
  unsubscribeGps?.();
  if (heartbeat) clearInterval(heartbeat);
  stopListeners?.();
  stopListeners = null; unsubscribeGps = null; heartbeat = null;
  lastFixAt = 0; lastWriteAt = 0; lastError = '';
}
export function isDriverGpsRunning() { return unsubscribeGps !== null; }
export function getGpsStats() {
  return { running: isDriverGpsRunning(), lastFixAgeMs: Date.now() - lastFixAt,
    lastWriteAgeMs: Date.now() - lastWriteAt, error: lastError };
}
