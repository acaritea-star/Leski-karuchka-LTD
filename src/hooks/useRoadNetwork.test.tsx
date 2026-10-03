// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ snapshot: vi.fn(), edge: vi.fn() }));
vi.mock('@/lib/roadSnapshot', () => ({ loadRoadSnapshot: fake.snapshot }));
vi.mock('@/lib/edgeRequest', () => ({ invokeEdge: fake.edge }));
let useRoadNetwork: typeof import('./useRoadNetwork').useRoadNetwork;
const point = { lat: 42.6977, lng: 23.3219 };
beforeEach(async () => {
  vi.useFakeTimers(); vi.resetModules(); vi.clearAllMocks();
  fake.snapshot.mockResolvedValue(null); fake.edge.mockResolvedValue({ data: null, error: new Error('offline') });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  useRoadNetwork = (await import('./useRoadNetwork')).useRoadNetwork;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('shares concurrent road loads and retries failed tiles at most twice at 65-second intervals', async () => {
  renderHook(() => useRoadNetwork(point)); renderHook(() => useRoadNetwork(point));
  await act(async () => {}); expect(fake.edge).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTimeAsync(65_000)); expect(fake.edge).toHaveBeenCalledTimes(2);
  await act(async () => vi.advanceTimersByTimeAsync(65_000)); expect(fake.edge).toHaveBeenCalledTimes(3);
  await act(async () => vi.advanceTimersByTimeAsync(130_000)); expect(fake.edge).toHaveBeenCalledTimes(3);
});
it('loads immediately when a page first opened hidden becomes visible', async () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const view = renderHook(() => useRoadNetwork(point)); await act(async () => {});
  expect(fake.edge).not.toHaveBeenCalled();
  fake.edge.mockResolvedValue({ data: { roads: [{ points: [[point.lat, point.lng], [point.lat + .001, point.lng]], oneway: 0 }] }, error: null });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(fake.edge).toHaveBeenCalledOnce(); expect(view.result.current).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(120_000)); expect(fake.edge).toHaveBeenCalledOnce();
});
