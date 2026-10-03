/** One native watch for navigation and dispatch; one deduplicated fresh read. */
type Listener = (position: GeolocationPosition) => void;
type Failure = (error: unknown) => void;
const listeners = new Map<Listener, Failure>();
let watchId: number | null = null;
let epoch = 0;
let watchEpoch = 0;
let latest: GeolocationPosition | null = null;
let pending: Promise<GeolocationPosition> | null = null;
let cancelPending: (() => void) | null = null;
const observers = new Set<() => void>();
export const subscribeGpsState = (fn: () => void) => { observers.add(fn); return () => { observers.delete(fn); }; };
export const getGpsPosition = () => latest;
function publish(position: GeolocationPosition) {
  if (!latest || position.timestamp > latest.timestamp) latest = position;
  observers.forEach(fn => fn());
  listeners.forEach((_, fn) => fn(position));
}
export function subscribeGps(position: Listener, error: Failure = () => {}) {
  listeners.set(position, error);
  if (watchId === null && navigator.geolocation) {
    const run = watchEpoch;
    watchId = navigator.geolocation.watchPosition(value => { if (run === watchEpoch) publish(value); },
      value => { if (run === watchEpoch) listeners.forEach(fn => fn(value)); },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  }
  if (latest && Date.now() - latest.timestamp < 30_000 && latest.timestamp <= Date.now() + 30_000) position(latest);
  return () => {
    listeners.delete(position);
    if (!listeners.size && watchId !== null) {
      navigator.geolocation.clearWatch(watchId); watchId = null; watchEpoch++;
    }
  };
}
export function requestGps(): Promise<GeolocationPosition> {
  if (pending) return pending;
  if (!navigator.geolocation) return Promise.reject(new Error('Браузърът не поддържа GPS.'));
  const run = epoch;
  const task = new Promise<GeolocationPosition>((resolve, reject) => {
    cancelPending = () => reject(new Error('Местоположението е изключено.'));
    navigator.geolocation.getCurrentPosition(value => {
      if (run !== epoch) return reject(new Error('Местоположението е изключено.'));
      publish(value); resolve(value);
    }, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
  });
  pending = task;
  void task.finally(() => { if (pending === task) { pending = null; cancelPending = null; } }).catch(() => {});
  return task;
}
export function stopSharedGps() {
  epoch++; watchEpoch++;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; latest = null;
  cancelPending?.(); cancelPending = null; pending = null;
  observers.forEach(fn => fn());
}
export async function gpsPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch { return 'unknown'; }
}
