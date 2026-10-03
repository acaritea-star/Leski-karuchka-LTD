// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getGpsPosition, requestGps, stopSharedGps, subscribeGps } from './sharedGps';
import { getLocationEnabled, setLocationEnabled, subscribeLocationPreference } from './locationPreference';
let receive!: PositionCallback;
let read!: PositionCallback;
type PositionCallback = (position: GeolocationPosition) => void;
const watch = vi.fn((fn: PositionCallback) => { receive = fn; return 7; });
const get = vi.fn((fn: PositionCallback) => { read = fn; });
const clear = vi.fn();
const releases: Array<() => void> = [];
const fix = (timestamp = Date.now()) => ({ timestamp, coords: { latitude: 43.3, longitude: 25.1, accuracy: 10 } } as GeolocationPosition);
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { watchPosition: watch, getCurrentPosition: get, clearWatch: clear } });
});
afterEach(() => { releases.splice(0).forEach(fn => fn()); stopSharedGps(); localStorage.clear(); });
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
  read(fix(Date.now() - 60_000)); await first;
  const third = requestGps(); expect(get).toHaveBeenCalledTimes(2);
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
