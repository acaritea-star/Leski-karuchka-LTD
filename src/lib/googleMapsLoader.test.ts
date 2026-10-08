// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.stubEnv('VITE_PUBLIC_GOOGLE_MAPS_API_KEY', 'mock-key'); vi.stubGlobal('google', undefined); });
afterEach(() => { document.querySelectorAll('script').forEach(script => script.remove()); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('shares one bootstrap and waits for Maps readiness, not just script load', async () => {
  const { loadGoogleMaps } = await import('./googleMapsLoader');
  const first = loadGoogleMaps(); expect(loadGoogleMaps()).toBe(first);
  expect(document.querySelectorAll('script')).toHaveLength(1);
  document.querySelector('script')!.dispatchEvent(new Event('load'));
  expect(vi.getTimerCount()).toBe(1);
  vi.stubGlobal('google', { maps: { Map: class {} } });
  await vi.advanceTimersByTimeAsync(50); await first;
  expect(vi.getTimerCount()).toBe(0);
});
it('cleans a failed attempt and retries without leaving polling timers', async () => {
  const { loadGoogleMaps } = await import('./googleMapsLoader');
  const failed = loadGoogleMaps().catch(error => error);
  document.querySelector('script')!.dispatchEvent(new Event('error'));
  expect(await failed).toBeInstanceOf(Error); expect(vi.getTimerCount()).toBe(0);
  expect(document.querySelector('script')).toBeNull();
  const retry = loadGoogleMaps();
  expect(document.querySelectorAll('script')).toHaveLength(1);
  vi.stubGlobal('google', { maps: { Map: class {} } });
  await vi.advanceTimersByTimeAsync(50); await retry;
});
it('removes a stalled bootstrap after the deadline and permits another attempt', async () => {
  const { loadGoogleMaps } = await import('./googleMapsLoader');
  const failed = loadGoogleMaps().catch(error => error);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await failed).toBeInstanceOf(Error);
  expect(document.querySelector('script')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
