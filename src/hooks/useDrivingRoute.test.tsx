// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDrivingRoute } from './useDrivingRoute';
import { computeRoute, type RouteResult } from '@/lib/googleMaps';
import type { VehicleFix } from '@/lib/vehicleMotion';
vi.mock('@/lib/googleMaps', () => ({ computeRoute: vi.fn(), decodePolyline: (polyline: string) => polyline === 'long'
  ? [{ lat: 43, lng: 25 }, { lat: 43.1, lng: 25 }]
  : [{ lat: 43, lng: 25 }, { lat: 43.001, lng: 25 }] }));
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
it('keeps the same road while GPS advances past the old 120-metre and 45-second refresh thresholds', async () => {
  vi.mocked(computeRoute).mockResolvedValue({ ...result, polyline: 'long' });
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  const path = view.result.current.path;
  for (let n = 1; n <= 12; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    view.rerender({ gps: fix(43 + n * .0002) });
  }
  expect(computeRoute).toHaveBeenCalledTimes(1);
  expect(view.result.current.path).toBe(path);
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
  await act(async () => vi.advanceTimersByTime(10_000));
  expect(view.result.current.info).toEqual(result);
  view.unmount();
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(computeRoute).toHaveBeenCalledTimes(2);
});

it('makes only the two initial calls for two visible screens following the road for 20 minutes', async () => {
  vi.mocked(computeRoute).mockResolvedValue({ ...result, polyline: 'long', distance_km: 11.12, duration_sec: 1800, duration_min: 30 });
  const a = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25, { requestId: 'ride', purpose: 'destination' }), { initialProps: { gps: fix() } });
  const b = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25, { requestId: 'ride', purpose: 'destination' }), { initialProps: { gps: fix() } });
  await act(async () => {});
  const initialPath = a.result.current.path;
  for (let n = 1; n <= 240; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    const gps = fix(43 + n * (30 / 3.6 * 5 / 111_195));
    a.rerender({ gps }); b.rerender({ gps });
  }
  expect(computeRoute).toHaveBeenCalledTimes(2);
  expect(a.result.current.path).toBe(initialPath);
  expect(a.result.current.error).toBe(false);
});

it('ignores a single GPS jump and inaccurate fixes, but reroutes after persistent accurate deviation', async () => {
  vi.mocked(computeRoute).mockResolvedValue({ ...result, polyline: 'long' });
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(30_000));
  view.rerender({ gps: { ...fix(43.005), lng: 25.002 } });
  await act(async () => vi.advanceTimersByTime(5000));
  view.rerender({ gps: fix(43.005) });
  for (let n = 0; n < 4; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    view.rerender({ gps: { ...fix(43.006), lng: 25.002, accuracy: 80 } });
  }
  expect(computeRoute).toHaveBeenCalledOnce();
  for (let n = 0; n < 3; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    view.rerender({ gps: { ...fix(43.007), lng: 25.002 } });
  }
  await act(async () => {});
  expect(computeRoute).toHaveBeenCalledTimes(2);
  expect(computeRoute).toHaveBeenLastCalledWith(expect.objectContaining({ lat: 43.007, lng: 25.002 }), expect.anything(), expect.anything());
});

it('does not treat repeated timer checks of the same off-road fix as independent evidence', async () => {
  vi.mocked(computeRoute).mockResolvedValue({ ...result, polyline: 'long' });
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  await act(async () => vi.advanceTimersByTime(30_000));
  view.rerender({ gps: { ...fix(43.005), lng: 25.002 } });
  await act(async () => vi.advanceTimersByTime(35_000));
  expect(computeRoute).toHaveBeenCalledOnce();
});

it('backs off and bounds failures instead of spending the daily quota on retries', async () => {
  vi.mocked(computeRoute).mockResolvedValue(null);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  for (let n = 0; n < 60; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    view.rerender({ gps: fix() });
  }
  expect(computeRoute).toHaveBeenCalledTimes(3);
  expect(view.result.current.blocked).toBe(true);
});

it('honours the server retry deadline and does not retry an authorization rejection', async () => {
  vi.mocked(computeRoute).mockResolvedValueOnce({ ...result, success: false, status: 429, retry_after_sec: 3600 });
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  for (let n = 0; n < 24; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    view.rerender({ gps: fix() });
  }
  expect(computeRoute).toHaveBeenCalledOnce();
  view.unmount();
  vi.mocked(computeRoute).mockResolvedValue({ ...result, success: false, status: 403 });
  const denied = renderHook(({ gps }) => useDrivingRoute(gps, 43.1, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  for (let n = 0; n < 24; n++) {
    await act(async () => vi.advanceTimersByTime(5000));
    denied.rerender({ gps: fix() });
  }
  expect(computeRoute).toHaveBeenCalledTimes(2);
  expect(denied.result.current.blocked).toBe(true);
});

it('restores the cached estimate if the car moves away from the pin along the same road', async () => {
  vi.mocked(computeRoute).mockResolvedValue(result);
  const view = renderHook(({ gps }) => useDrivingRoute(gps, 43.001, 25), { initialProps: { gps: fix() } });
  await act(async () => {});
  view.rerender({ gps: fix(43.001) });
  expect(view.result.current.info?.distance_km).toBe(0);
  await act(async () => vi.advanceTimersByTime(5000));
  view.rerender({ gps: fix(43.0007) });
  expect(view.result.current.info).toEqual(result);
  expect(computeRoute).toHaveBeenCalledOnce();
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

it('retains the last known road at arrival without another Google request',async()=>{
 vi.mocked(computeRoute).mockResolvedValue(result);
 const view=renderHook(({gps})=>useDrivingRoute(gps,43.001,25),{initialProps:{gps:fix()}});
 await act(async()=>{});
 const path=view.result.current.path;
 act(()=>vi.advanceTimersByTime(5000));view.rerender({gps:fix(43.001)});
 expect(view.result.current.path).toBe(path);expect(view.result.current.info?.distance_km).toBe(0);
 expect(computeRoute).toHaveBeenCalledOnce();
});
