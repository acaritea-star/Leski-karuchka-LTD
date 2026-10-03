// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDrivingRoute } from './useDrivingRoute';
import { computeRoute, type RouteResult } from '@/lib/googleMaps';
import type { VehicleFix } from '@/lib/vehicleMotion';
vi.mock('@/lib/googleMaps', () => ({ computeRoute: vi.fn(), decodePolyline: () => [{ lat: 43, lng: 25 }, { lat: 43.001, lng: 25 }] }));
const result: RouteResult = { success: true, polyline: 'route', distance_km: 1, duration_min: 3, duration_sec: 180, legs: [], alternatives_count: 0 };
const fix = (lat = 43): VehicleFix => ({ lat, lng: 25, timestamp: Date.now(), heading: 0, speed: 6, accuracy: 8 });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); vi.clearAllMocks();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('keeps an in-flight route when newer GPS fixes arrive', async () => {
  let resolve!: (value: RouteResult) => void;
  vi.mocked(computeRoute).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.002, 25), { initialProps: { gps: fix() } });
  act(() => vi.advanceTimersByTime(5000));
  view.rerender({ gps: fix(43.0001) });
  expect(computeRoute).toHaveBeenCalledTimes(1);
  await act(async () => resolve(result));
  expect(view.result.current.info).toEqual(result);
  expect(view.result.current.path).toHaveLength(2);
});
it('clears the pickup leg and ignores its late reply after switching to the destination', async () => {
  let first!: (value: RouteResult) => void, second!: (value: RouteResult) => void;
  vi.mocked(computeRoute).mockReturnValueOnce(new Promise(done => { first = done; }))
    .mockReturnValueOnce(new Promise(done => { second = done; }));
  const view = renderHook(({ target }) => useDrivingRoute(fix(), target, 25), { initialProps: { target: 43.001 } });
  view.rerender({ target: 43.002 });
  await act(async () => second({ ...result, distance_km: 2 }));
  await act(async () => first(result));
  expect(view.result.current.info?.distance_km).toBe(2);
  expect(computeRoute).toHaveBeenLastCalledWith(expect.anything(), { lat: 43.002, lng: 25 }, expect.anything());
});
it('accumulates small GPS steps and refreshes using the latest fix with bounded frequency', async () => {
  vi.mocked(computeRoute).mockResolvedValue(result);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.002, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  for (let n = 1; n <= 8; n++) {
    act(() => vi.advanceTimersByTime(1000));
    view.rerender({ gps: fix(43 + n * .0002) });
  }
  expect(computeRoute).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(2000));
  expect(computeRoute).toHaveBeenCalledTimes(2);
  expect(computeRoute).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 43.0016 }), expect.anything(), expect.anything());
});
it('makes no requests for missing, inaccurate or stale GPS and retries a failed route', async () => {
  vi.mocked(computeRoute).mockResolvedValueOnce(null).mockResolvedValue(result);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.002, 25), { initialProps: { gps: null as VehicleFix | null } });
  view.rerender({ gps: { ...fix(), timestamp: Date.now() - 60_000 } });
  view.rerender({ gps: { ...fix(), accuracy: 300 } });
  expect(computeRoute).not.toHaveBeenCalled();
  view.rerender({ gps: fix() });
  await act(async () => {});
  expect(view.result.current.error).toBe(true);
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(view.result.current.error).toBe(false);
  expect(computeRoute).toHaveBeenCalledTimes(2);
});
it('bounds a hung request and stops all refreshes after unmount', async () => {
  vi.mocked(computeRoute).mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(result);
  const gps = fix();
  const view = renderHook(() => useDrivingRoute(gps, 43.002, 25));
  await act(async () => vi.advanceTimersByTime(20_000));
  expect(view.result.current.error).toBe(true);
  await act(async () => vi.advanceTimersByTime(5000));
  expect(view.result.current.info).toEqual(result);
  view.unmount();
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(computeRoute).toHaveBeenCalledTimes(2);
});
it('handles a car at the pin without repeated route requests, and resumes after it moves away', async () => {
  vi.mocked(computeRoute).mockResolvedValue(result);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43, 25), { initialProps: { gps: fix() } });
  expect(view.result.current.info?.distance_km).toBe(0);
  expect(view.result.current.error).toBe(false);
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(computeRoute).not.toHaveBeenCalled();
  view.rerender({ gps: fix(43.001) });
  await act(async () => {});
  expect(computeRoute).toHaveBeenCalledOnce();
});
it('keeps the existing route while parked instead of making timer-only API calls', async () => {
  vi.mocked(computeRoute).mockResolvedValue(result);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.002, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  for (let n = 0; n < 6; n++) {
    act(() => vi.advanceTimersByTime(10_000));
    view.rerender({ gps: fix() });
  }
  expect(computeRoute).toHaveBeenCalledOnce();
});
