// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getGpsPosition, gpsErrorMessage, requestGps, stopSharedGps, subscribeGps } from './sharedGps';
import { getLocationEnabled, setLocationEnabled, subscribeLocationPreference } from './locationPreference';
let receive!: PositionCallback;
let read!: PositionCallback;
let readError!: (error: GeolocationPositionError) => void;
let watchError!: (error: GeolocationPositionError) => void;
type PositionCallback = (position: GeolocationPosition) => void;
const watch = vi.fn((fn: PositionCallback, failure: typeof watchError) => { receive = fn; watchError = failure; return 7; });
const get = vi.fn((fn: PositionCallback, failure: typeof readError, _options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }) => { read = fn; readError = failure; });
const clear = vi.fn();
const releases: Array<() => void> = [];
const fix = (timestamp = Date.now()) => ({ timestamp, coords: { latitude: 43.3, longitude: 25.1, accuracy: 10 } } as GeolocationPosition);
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, getCurrentPosition: get, clearWatch: clear } });
});
afterEach(() => { releases.splice(0).forEach(fn => fn()); stopSharedGps(); localStorage.clear(); vi.useRealTimers(); });
it('shares a single native watch between dispatch and navigation and releases it only after both leave', () => {
  const dispatch = vi.fn(), navigation = vi.fn();
  const a = subscribeGps(dispatch), b = subscribeGps(navigation); releases.push(a, b);
  expect(watch).toHaveBeenCalledTimes(1);
  const position = fix(); receive(position);
  expect(dispatch).toHaveBeenCalledWith(position); expect(navigation).toHaveBeenCalledWith(position);
  a(); expect(clear).not.toHaveBeenCalled();
  b(); expect(clear).toHaveBeenCalledWith(7);
});
it('deduplicates concurrent fresh reads without returning a cached old position', async () => {
  const first = requestGps(), second = requestGps();
  expect(first).toBe(second); expect(get).toHaveBeenCalledTimes(1);
  read(fix(Date.now() - 60_000)); expect(getGpsPosition()).toBeNull();
  expect(get).toHaveBeenCalledTimes(2); read(fix()); await first;
  const third = requestGps(); expect(get).toHaveBeenCalledTimes(3);
  read(fix()); await third;
});
it('turning off cancels pending reads, clears memory and ignores late native callbacks', async () => {
  const fn = vi.fn(); releases.push(subscribeGps(fn));
  receive(fix()); expect(getGpsPosition()).not.toBeNull();
  const pending = requestGps();
  const rejected = expect(pending).rejects.toThrow('изключено');
  setLocationEnabled('driver-user', false);
  receive(fix()); read(fix());
  await rejected;
  expect(fn).toHaveBeenCalledTimes(1); expect(getGpsPosition()).toBeNull();
  expect(clear).toHaveBeenCalledWith(7);
});
it('remembers an explicit off separately for each account and reacts to another tab', () => {
  setLocationEnabled('one', true); setLocationEnabled('two', false);
  expect(getLocationEnabled('one')).toBe(true); expect(getLocationEnabled('two')).toBe(false);
  const changed = vi.fn(); releases.push(subscribeLocationPreference(changed, 'one'));
  localStorage.setItem('leski:auto-location:one', 'off');
  window.dispatchEvent(new StorageEvent('storage', { key: 'leski:auto-location:one', newValue: 'off' }));
  expect(getLocationEnabled('one')).toBe(false); expect(changed).toHaveBeenCalled();
});

it('replays a recent shared fix to a new navigation subscriber immediately', async () => {
  const pending = requestGps(); const position = fix(); read(position); await pending;
  const navigation = vi.fn(); releases.push(subscribeGps(navigation));
  expect(navigation).toHaveBeenCalledWith(position);
});
it('closing a watch consumer does not invalidate a separate fresh read', async () => {
  const release = subscribeGps(() => {}); releases.push(release);
  const pending = requestGps(); release(); const position = fix(); read(position);
  await expect(pending).resolves.toBe(position);
});

it('falls back once to device positioning after a precise GPS timeout, sharing the same read', async () => {
  const first = requestGps(), second = requestGps();
  expect(first).toBe(second);
  readError({ code: 3 } as GeolocationPositionError);
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 0 });
  const value = fix(); read(value);
  await expect(first).resolves.toBe(value);
});
it('bounds browsers that never invoke either native callback and ignores a late success', async () => {
  const first = requestGps(); const oldRead = read;
  const rejected = expect(first).rejects.toMatchObject({ code: 3 });
  await vi.advanceTimersByTimeAsync(14_000);
  expect(get).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(10_000); await rejected;
  oldRead(fix()); read(fix()); expect(getGpsPosition()).toBeNull();
  const next = requestGps(); read(fix()); await next;
  expect(get).toHaveBeenCalledTimes(3);
});
it('never retries or falls back after permission denial', async () => {
  const pending = requestGps(); const rejected = expect(pending).rejects.toMatchObject({ code: 1 });
  readError({ code: 1 } as GeolocationPositionError); await rejected;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(get).toHaveBeenCalledOnce(); expect(getGpsPosition()).toBeNull();
  expect(gpsErrorMessage({ code: 3 })).toContain('актуална позиция');
  expect(gpsErrorMessage({ code: 2 })).toContain('недостъпно');
});
it('does not publish invalid or out-of-order native callbacks', () => {
  const fn = vi.fn(), error = vi.fn(); releases.push(subscribeGps(fn, error));
  const newest = fix(); receive(newest);
  receive(fix(Date.now() - 1000));
  receive({ ...fix(), coords: { ...fix().coords, latitude: NaN } });
  expect(fn).toHaveBeenCalledOnce(); expect(getGpsPosition()).toBe(newest);
  expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: 'Невалидна GPS позиция.' }));
});
it('restarts a stale watch on pageshow and fences callbacks from the suspended watch', async () => {
  const fn = vi.fn(); releases.push(subscribeGps(fn));
  receive(fix()); const suspended = receive;
  await vi.advanceTimersByTimeAsync(31_000);
  window.dispatchEvent(new Event('pageshow'));
  expect(watch).toHaveBeenCalledTimes(2); expect(clear).toHaveBeenCalledWith(7);
  suspended(fix()); expect(fn).toHaveBeenCalledOnce();
  receive(fix()); expect(fn).toHaveBeenCalledTimes(2);
});
it('never restarts location after explicit off even when the app resumes or the network returns', async () => {
  releases.push(subscribeGps(() => {}));
  watchError({ code: 3 } as GeolocationPositionError);
  stopSharedGps();
  window.dispatchEvent(new Event('pageshow')); window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(watch).toHaveBeenCalledOnce(); expect(get).not.toHaveBeenCalled();
});
it('handles synchronous browser security errors without crashing a GPS subscriber', () => {
  watch.mockImplementationOnce(() => { throw new DOMException('Blocked', 'SecurityError'); });
  const error = vi.fn();
  expect(() => { releases.push(subscribeGps(() => {}, error)); }).not.toThrow();
  expect(gpsErrorMessage(error.mock.calls[0][0])).toContain('Разреши');
});
it('observes permission revocation without automatic prompts and resumes only when granted again', async () => {
  const status = Object.assign(new EventTarget(), { state: 'granted' });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: vi.fn().mockResolvedValue(status) } });
  const error = vi.fn(); releases.push(subscribeGps(() => {}, error)); await Promise.resolve();
  status.state = 'denied'; status.dispatchEvent(new Event('change'));
  window.dispatchEvent(new Event('pageshow'));
  expect(clear).toHaveBeenCalledWith(7); expect(watch).toHaveBeenCalledOnce();
  expect(error).toHaveBeenCalledWith({ code: 1 });
  status.state = 'granted'; status.dispatchEvent(new Event('change'));
  expect(watch).toHaveBeenCalledTimes(2);
});
it('limits native watch recovery attempts and removes their timers when the last subscriber leaves', async () => {
  const release = subscribeGps(() => {}); releases.push(release);
  for (const delay of [15_000, 30_000, 60_000]) {
    watchError({ code: 2 } as GeolocationPositionError); await vi.advanceTimersByTimeAsync(delay);
  }
  watchError({ code: 2 } as GeolocationPositionError);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(watch).toHaveBeenCalledTimes(4);
  release(); expect(vi.getTimerCount()).toBe(0);
});
it('expires a one-shot read on return from frozen browser timers', async () => {
  const task = requestGps(), rejected = expect(task).rejects.toMatchObject({ code: 3 });
  vi.setSystemTime(Date.now() + 60_000); window.dispatchEvent(new Event('pageshow')); await rejected;
  read(fix()); expect(getGpsPosition()).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
it('pauses a hidden watch and resumes immediately without waiting for a restart throttle',()=>{
 const consumer=vi.fn();releases.push(subscribeGps(consumer));const previous=receive;
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
 expect(clear).toHaveBeenCalledWith(7);previous(fix());expect(consumer).not.toHaveBeenCalled();
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));
 expect(watch).toHaveBeenCalledTimes(2);receive(fix());expect(consumer).toHaveBeenCalledOnce();
});
it('fences frozen-page callbacks and starts a fresh watch on restoration',()=>{
 const consumer=vi.fn();releases.push(subscribeGps(consumer));const previous=receive;
 document.dispatchEvent(new Event('freeze'));previous(fix());expect(consumer).not.toHaveBeenCalled();
 window.dispatchEvent(new Event('pageshow'));expect(watch).toHaveBeenCalledTimes(2);receive(fix());expect(consumer).toHaveBeenCalledOnce();
});

it('uses a valid watch fix when a concurrent one-shot read stalls, and fences its late timeout',async()=>{
 const sink=vi.fn();releases.push(subscribeGps(sink));const first=requestGps(),oldFailure=readError;
 await vi.advanceTimersByTimeAsync(1000);const measured=fix();receive(measured);
 await expect(first).resolves.toBe(measured);oldFailure({code:3} as GeolocationPositionError);
 expect(get).toHaveBeenCalledOnce();expect(sink).toHaveBeenCalledOnce();
});
it('recovers two stale native reads without publishing or retimestamping the old GPS',async()=>{
 const task=requestGps();const old=fix(Date.now()-60000);read(old);read(old);
 expect(getGpsPosition()).toBeNull();const measured=fix();receive(measured);
 await expect(task).resolves.toBe(measured);expect(getGpsPosition()?.timestamp).toBe(measured.timestamp);
 expect(watch).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});
it('bounds repeated stale readings and releases the recovery watch at the original deadline',async()=>{
 const task=requestGps(),rejected=expect(task).rejects.toMatchObject({code:3});
 read(fix(Date.now()-60000));read(fix(Date.now()-60000));
 await vi.advanceTimersByTimeAsync(1000);read(fix(Date.now()-60000));
 await vi.advanceTimersByTimeAsync(23000);await rejected;
 expect(get).toHaveBeenCalledTimes(3);expect(getGpsPosition()).toBeNull();expect(clear).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it('reuses only a measured fix younger than five seconds when explicitly allowed',async()=>{
 const pending=requestGps(),measured=fix();read(measured);await pending;
 await expect(requestGps({maximumAgeMs:5000})).resolves.toBe(measured);expect(get).toHaveBeenCalledOnce();
 await vi.advanceTimersByTimeAsync(5001);const next=requestGps({maximumAgeMs:5000});read(fix());await next;
 expect(get).toHaveBeenCalledTimes(2);
});
