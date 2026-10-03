/** One native watch for navigation and dispatch; one deduplicated fresh read. */
type Listener = (position: GeolocationPosition) => void;
type Failure = (error: unknown) => void;
const listeners = new Map<Listener, Failure>();
const observers = new Set<() => void>();
let watchId: number | null = null;
let epoch = 0, watchEpoch = 0;
let latest: GeolocationPosition | null = null;
let pending: Promise<GeolocationPosition> | null = null;
let cancelPending: (() => void) | null = null;
let detachLifecycle: (() => void) | null = null;
let recovery: ReturnType<typeof setTimeout> | undefined;
let recoveryAttempts = 0;
let permissionBlocked = false;
let lastRestart = -Infinity;
export const subscribeGpsState = (fn: () => void) => { observers.add(fn); return () => { observers.delete(fn); }; };
export const getGpsPosition = () => latest;

const errorCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? error.code : undefined;
export const isGpsPermissionDenied = (error: unknown) => errorCode(error) === 1 || !!(error && typeof error === 'object' && 'name' in error && error.name === 'SecurityError');
export function gpsErrorMessage(error: unknown, english = false): string {
  if (isGpsPermissionDenied(error)) error = { code: 1 };
  switch (errorCode(error)) {
    case 1: return english ? 'Allow location access in your browser settings.' : 'Разреши достъп до местоположението от настройките на браузъра.';
    case 2: return english ? 'Location is unavailable. Turn on location services and try again.' : 'Местоположението е недостъпно. Включи локацията на устройството и опитай отново.';
    case 3: return english ? 'Location took too long. Try again outdoors or choose an address.' : 'Локацията се забави. Опитай на открито или избери адрес.';
    default: return error instanceof Error ? error.message : english ? 'Check location services and your connection.' : 'Провери локацията на устройството и връзката.';
  }
}
function positionProblem(position: GeolocationPosition): Error | null {
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 30_000 || position.timestamp > Date.now() + 30_000) return new Error('GPS позицията е остаряла.');
  if (![latitude, longitude, accuracy].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || accuracy < 0) return new Error('Невалидна GPS позиция.');
  return null;
}
function publish(position: GeolocationPosition) {
  // A delayed native callback cannot rewind the shared position or the car.
  if (latest && (position.timestamp < latest.timestamp || position.timestamp === latest.timestamp && position.coords.accuracy >= latest.coords.accuracy)) return;
  latest = position;
  recoveryAttempts = 0;
  if (recovery !== undefined) { clearTimeout(recovery); recovery = undefined; }
  observers.forEach(fn => fn());
  listeners.forEach((_, fn) => fn(position));
}
function clearWatch() {
  watchEpoch++;
  if (watchId !== null) navigator.geolocation?.clearWatch(watchId);
  watchId = null;
}
function report(error: unknown) { listeners.forEach(fn => fn(error)); }
function scheduleRecovery() {
  if (recovery !== undefined || recoveryAttempts >= 3 || permissionBlocked || !listeners.size) return;
  recovery = setTimeout(() => {
    recovery = undefined;
    if (document.visibilityState === 'hidden') return;
    recoveryAttempts++;
    clearWatch(); startWatch();
  }, 15_000 * 2 ** recoveryAttempts);
}
function startWatch() {
  if (watchId !== null || permissionBlocked || !listeners.size) return;
  if (!navigator.geolocation) { report(new Error('Браузърът не поддържа GPS.')); return; }
  const run = watchEpoch;
  const fail = (error: unknown) => {
    if (run !== watchEpoch) return;
    if (isGpsPermissionDenied(error)) {
      permissionBlocked = true; clearWatch();
    } else scheduleRecovery();
    report(error);
  };
  try {
    const id = navigator.geolocation.watchPosition(position => {
      if (run !== watchEpoch) return;
      const problem = positionProblem(position);
      if (problem) fail(problem); else publish(position);
    }, fail, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
    if (run === watchEpoch) watchId = id;
    else navigator.geolocation.clearWatch(id);
  } catch (error) { fail(error); }
}
function attachLifecycle() {
  if (detachLifecycle) return;
  let active = true;
  let permission: PermissionStatus | undefined;
  let hiddenAt: number | null = null;
  const resume = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (permissionBlocked || Date.now() - lastRestart < 5000) return;
    const stale = !latest || Date.now() - latest.timestamp >= 30_000;
    const suspended = hiddenAt !== null && Date.now() - hiddenAt > 5000;
    hiddenAt = null;
    if (!stale && !suspended && watchId !== null) return;
    lastRestart = Date.now();
    recoveryAttempts = 0;
    clearWatch(); startWatch();
  };
  const changed = () => {
    if (!active) return;
    permissionBlocked = permission?.state !== 'granted';
    if (permissionBlocked) { clearWatch(); report({ code: 1 }); }
    else { lastRestart = -Infinity; resume(); }
  };
  // Permissions API is optional (notably on older Safari). Native errors and
  // explicit GPS actions still work when querying permission is unsupported.
  try {
    void navigator.permissions?.query({ name: 'geolocation' }).then(status => {
      if (!active) return;
      permission = status;
      status.addEventListener?.('change', changed);
    }).catch(() => {});
  } catch { /* Permission querying is an optional enhancement. */ }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  detachLifecycle = () => {
    active = false;
    permission?.removeEventListener?.('change', changed);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('pageshow', resume);
    window.removeEventListener('online', resume);
    detachLifecycle = null;
  };
}
export function subscribeGps(position: Listener, error: Failure = () => {}) {
  listeners.set(position, error);
  attachLifecycle(); startWatch();
  if (latest && !positionProblem(latest)) position(latest);
  return () => {
    listeners.delete(position);
    if (!listeners.size) {
      clearWatch(); detachLifecycle?.();
      if (recovery !== undefined) { clearTimeout(recovery); recovery = undefined; }
    }
  };
}
export function requestGps(): Promise<GeolocationPosition> {
  if (pending) return pending;
  if (!navigator.geolocation) return Promise.reject(new Error('Браузърът не поддържа GPS.'));
  const run = epoch;
  const deadline = Date.now() + 24_000;
  const task = new Promise<GeolocationPosition>((resolve, reject) => {
    let settled = false, attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = { code: 3 };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkDeadline);
      window.removeEventListener('pageshow', checkDeadline);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    };
    const checkDeadline = () => { if (Date.now() >= deadline) fail(timeout); };
    cancelPending = () => fail(new Error('Местоположението е изключено.'));
    document.addEventListener('visibilitychange', checkDeadline);
    window.addEventListener('pageshow', checkDeadline);
    const read = (precise: boolean) => {
      const token = ++attempt;
      const failure = (error: unknown) => {
        if (settled || token !== attempt) return;
        if (timer !== undefined) clearTimeout(timer);
        if (precise && !isGpsPermissionDenied(error) && Date.now() < deadline) read(false);
        else { if (isGpsPermissionDenied(error)) { permissionBlocked = true; clearWatch(); report(error); } fail(error); }
      };
      // Browsers can suspend or omit their native timeout. Keep our own limit.
      timer = setTimeout(() => failure(timeout), Math.min(precise ? 14_000 : 10_000, Math.max(0, deadline - Date.now())));
      try {
        navigator.geolocation.getCurrentPosition(position => {
          if (settled || token !== attempt) return;
          if (run !== epoch) { fail(new Error('Местоположението е изключено.')); return; }
          if (Date.now() >= deadline) { fail(timeout); return; }
          const problem = positionProblem(position);
          if (problem) { failure(problem); return; }
          settled = true; cleanup(); permissionBlocked = false;
          publish(position);
          if (listeners.size) { attachLifecycle(); startWatch(); }
          resolve(latest ?? position);
        }, failure, { enableHighAccuracy: precise, timeout: precise ? 12_000 : 8000, maximumAge: 0 });
      } catch (error) { failure(error); }
    };
    read(true);
  });
  pending = task;
  void task.finally(() => { if (pending === task) { pending = null; cancelPending = null; } }).catch(() => {});
  return task;
}
export function stopSharedGps() {
  epoch++; clearWatch(); detachLifecycle?.();
  latest = null; permissionBlocked = false; recoveryAttempts = 0; lastRestart = -Infinity;
  if (recovery !== undefined) { clearTimeout(recovery); recovery = undefined; }
  cancelPending?.(); cancelPending = null; pending = null;
  observers.forEach(fn => fn());
}
export async function gpsPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try { return (await navigator.permissions.query({ name: 'geolocation' })).state; }
  catch { return 'unknown'; }
}
