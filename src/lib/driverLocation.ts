import { isInBulgaria, SERVICE_AREA_ERROR } from './serviceArea';
import { supabase } from '@/lib/supabase';
import { gpsErrorMessage, isGpsPermissionDenied, requestGps, subscribeGps } from './sharedGps';
import { getLocationEnabled, setLocationEnabled } from './locationPreference';
import { withRequestTimeout } from './requestTimeout';
import { isAmbiguousWrite } from './rideOperations';
import type { Tables } from './database.types';
import { distanceMetres } from './routeGeometry';
import { bufferGps, readBufferedGps, clearGpsBuffer } from './gpsBuffer';
import { gpsPermission } from './sharedGps';

export const GPS_HEARTBEAT_MS = 15_000;
export const GPS_STALE_MS = 45_000;
export const GPS_MAX_ACCURACY_METERS = 100;
const MOVING_INTERVAL_MS = 5_000;
let generation = 0;
let unsubscribeGps: (() => void) | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastFixAt = 0, lastWriteAt = 0, lastConfirmedFixAt = 0;
let lastError = '';
let stopListeners: (() => void) | null = null;
let bufferOwner: string | undefined;

type Callbacks = { onUpdate?: () => void; onError?: (message: string) => void };

export function isFreshTimestamp(value: string | null | undefined, now = Date.now()): boolean {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) && time <= now + 30_000 && now - time < GPS_STALE_MS;
}
export function getCurrentPosition(): Promise<GeolocationPosition> { return requestGps(); }
function validatePosition(position: GeolocationPosition) {
  if (!Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 30_000 || position.timestamp > Date.now() + 30_000) throw new Error('GPS позицията е остаряла.');
  if (!Number.isFinite(position.coords.accuracy) || position.coords.accuracy < 0 || position.coords.accuracy > GPS_MAX_ACCURACY_METERS) throw new Error('Неточна GPS позиция. Изчакай по-добър сигнал.');
  if (!isInBulgaria(position.coords.latitude, position.coords.longitude)) throw new Error(SERVICE_AREA_ERROR);
}
export async function saveDriverPosition(id: string, company: string, position: GeolocationPosition, signal?: AbortSignal): Promise<string> {
  validatePosition(position);
  const { heading, speed } = position.coords;
  const { data, error } = await withRequestTimeout(abort => supabase.from('driver_locations').upsert({
    driver_id: id, company_id: company,
    latitude: position.coords.latitude, longitude: position.coords.longitude,
    heading: typeof heading === 'number' && Number.isFinite(heading) && heading >= 0 && heading < 360 ? heading : null,
    speed: typeof speed === 'number' && Number.isFinite(speed) && speed >= 0 ? speed : null,
    accuracy: position.coords.accuracy,
    position_at: new Date(position.timestamp).toISOString(),
  }, { onConflict: 'driver_id' }).select('updated_at').abortSignal(abort).single(), 15_000, signal, 'gps.write');
  if (error) throw new Error(error.message);
  if (!isFreshTimestamp(data?.updated_at)) throw new Error('Локацията не е потвърдена от сървъра.');
  return data!.updated_at;
}
export async function setDriverOnline(driver: { id: string; company_id: string; user_id?: string }, online: boolean) {
  if (online) {
    const position = await getCurrentPosition();
    await saveDriverPosition(driver.id, driver.company_id, position);
  }
  let confirmed: Tables<'drivers'> | null = null;
  try {
    const { data, error } = await withRequestTimeout(signal => supabase.from('drivers').update({ is_online: online })
      .eq('id', driver.id).select('*').abortSignal(signal).single(), 15_000, undefined, 'driver.online');
    if (error) throw error;
    if (!data || data.is_online !== online) throw new Error('Промяната не е потвърдена.');
    confirmed = data;
  } catch (cause) {
    if (isAmbiguousWrite(cause)) {
      try {
        const { data, error } = await withRequestTimeout(signal => supabase.from('drivers').select('*')
          .eq('id', driver.id).abortSignal(signal).maybeSingle(), 5000, undefined, 'driver.read');
        if (!error && data?.id === driver.id && data.is_online === online) confirmed = data;
      } catch { /* A lost acknowledgement does not authorize another write. */ }
    }
    if (!confirmed) throw cause instanceof Error ? cause : new Error(cause && typeof cause === 'object' && 'message' in cause
      ? String(cause.message) : 'Промяната не е потвърдена.');
  }
  if (online && driver.user_id) setLocationEnabled(driver.user_id, true);
  if (!online) stopDriverGps();
  return confirmed;
}
export function startDriverGps(id: string, company: string, callbacks: Callbacks = {}, userId?: string): boolean {
  stopDriverGps(false);
  if (bufferOwner && bufferOwner !== userId) clearGpsBuffer(bufferOwner);
  bufferOwner = userId;
  if (getLocationEnabled(userId) === false) { callbacks.onError?.('Местоположението е изключено от настройките.'); return false; }
  if (!navigator.geolocation) { callbacks.onError?.('Браузърът не поддържа GPS.'); return false; }
  const run = generation;
  let writing: GeolocationPosition | null = null;
  let queued: GeolocationPosition | null = null;
  let confirmedFix: GeolocationPosition | null = null;
  let locating = false, failures = 0, permissionDenied = false;
  let nextAttempt = 0, lastAttempt = -Infinity, lastRefresh = -Infinity;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  const writeDeadline = () => {
    if (failures || !queued || !confirmedFix) return nextAttempt;
    const a = confirmedFix.coords, b = queued.coords;
    const distance = distanceMetres({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude });
    const noise = Math.max(8, Math.min(25, Math.max(a.accuracy, b.accuracy)));
    const moving = b.speed != null && b.speed >= 1.5 || distance >= noise;
    return Math.max(nextAttempt, lastAttempt + (moving ? MOVING_INTERVAL_MS : GPS_HEARTBEAT_MS));
  };
  const fail = (error: unknown) => {
    if (run !== generation) return;
    if (isGpsPermissionDenied(error)) {
      permissionDenied = true; queued = null; controller?.abort();
      if (userId) clearGpsBuffer(userId);
      if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
    }
    lastError = gpsErrorMessage(error);
    callbacks.onError?.(lastError);
  };
  const schedule = () => {
    if (retry !== undefined || !queued || writing || run !== generation || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    retry = setTimeout(() => { retry = undefined; void drain(); }, Math.max(0, writeDeadline() - Date.now()));
  };
  const drain = async () => {
    if (run !== generation || writing || !queued || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    if (Date.now() < writeDeadline()) { schedule(); return; }
    const position = queued; queued = null;
    try { validatePosition(position); }
    catch (error) { fail(error); return; }
    writing = position;
    controller = new AbortController();
    lastAttempt = Date.now(); nextAttempt = lastAttempt + MOVING_INTERVAL_MS;
    try {
      const savedAt = await saveDriverPosition(id, company, position, controller.signal);
      if (run !== generation) return;
      lastWriteAt = Date.parse(savedAt);
      lastConfirmedFixAt = position.timestamp;
      confirmedFix = position;
      if (userId && (!queued || (queued as GeolocationPosition).timestamp <= position.timestamp)) clearGpsBuffer(userId);
      failures = 0; lastError = '';
      callbacks.onUpdate?.();
    } catch (error) {
      if (run !== generation) return;
      if (permissionDenied) return;
      // Keep at most one fix in memory. Never replay an offline journey.
      const newer = queued as GeolocationPosition | null; // Native callbacks can replace it during await.
      if (!permissionDenied && (!newer || newer.timestamp < position.timestamp)) queued = position;
      nextAttempt = Date.now() + Math.min(30_000, MOVING_INTERVAL_MS * 2 ** Math.min(failures++, 3));
      fail(error);
    } finally {
      writing = null; controller = null;
      schedule();
    }
  };
  const push = (position: GeolocationPosition) => {
    if (run !== generation) return;
    try { validatePosition(position); }
    catch (error) { fail(error); return; }
    permissionDenied = false;
    if (position.timestamp < lastFixAt) return;
    lastFixAt = position.timestamp;
    if (position.timestamp <= lastConfirmedFixAt || writing && position.timestamp <= writing.timestamp) return;
    queued = position;
    if (userId) bufferGps(userId, id, company, position);
    // Motion can shorten an idle deadline. Recompute from the latest fix,
    // while keeping the absolute throttle/backoff and one in-flight write.
    if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
    void drain();
  };
  const refresh = async () => {
    if (run !== generation || permissionDenied || document.visibilityState === 'hidden' || locating || Date.now() - lastRefresh < 1000) return;
    lastRefresh = Date.now(); locating = true;
    try { push(await getCurrentPosition()); }
    catch (error) { fail(error); }
    finally { locating = false; }
  };
  const resume = () => {
    if (document.visibilityState === 'hidden') return;
    if (queued) { try { validatePosition(queued); } catch { queued = null; if (userId) clearGpsBuffer(userId); } }
    failures = 0;
    nextAttempt = Math.max(lastAttempt + MOVING_INTERVAL_MS, Math.min(nextAttempt, Date.now()));
    if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
    void refresh();
    void drain();
  };
  unsubscribeGps = subscribeGps(push, fail);
  if (userId) void gpsPermission().then(permission => {
    if (run !== generation || permission !== 'granted' || permissionDenied || getLocationEnabled(userId) !== true) return;
    const saved = readBufferedGps(userId,id,company);
    if (saved && (!queued || saved.timestamp > queued.timestamp) && saved.timestamp > lastFixAt) push(saved);
  });
  heartbeat = setInterval(() => void refresh(), GPS_HEARTBEAT_MS);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('pageshow', resume);
  const offline = () => { lastError = 'Няма интернет. Последната актуална позиция се пази на устройството.'; callbacks.onError?.(lastError); };
  window.addEventListener('offline', offline);
  stopListeners = () => {
    controller?.abort();
    if (retry !== undefined) clearTimeout(retry);
    queued = null;
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('offline', offline);
  };
  return true;
}
export function stopDriverGps(clearBuffer = true) {
  if (clearBuffer && bufferOwner) { clearGpsBuffer(bufferOwner); bufferOwner = undefined; }
  generation++;
  unsubscribeGps?.();
  if (heartbeat) clearInterval(heartbeat);
  stopListeners?.();
  stopListeners = null; unsubscribeGps = null; heartbeat = null;
  lastFixAt = 0; lastWriteAt = 0; lastConfirmedFixAt = 0; lastError = '';
}
export function isDriverGpsRunning() { return unsubscribeGps !== null; }
export function getGpsStats() {
  return { running: isDriverGpsRunning(), lastFixAgeMs: Date.now() - lastFixAt,
    lastWriteAgeMs: Date.now() - lastWriteAt, lastConfirmedFixAgeMs: Date.now() - lastConfirmedFixAt, error: lastError };
}
