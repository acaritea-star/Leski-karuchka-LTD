// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { driverPosition, useDriverPosition, usePositionFreshness } from './useDriverPosition';
import { freshFix } from '@/lib/vehicleMotion';
const mocks = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn(), signals: [] as AbortSignal[], apply: null as ((payload: { new: Record<string, unknown> }) => void) | null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: (signal: AbortSignal) => { mocks.signals.push(signal); return { maybeSingle: mocks.read }; } }) }) }),
  channel: () => ({ on(_event: string, _filter: unknown, apply: typeof mocks.apply) { mocks.apply = apply; return this; }, subscribe() { return this; } }),
  removeChannel: mocks.remove,
} }));
const row = (offset = 0) => ({ latitude: 43, longitude: 25 + offset / 100_000, heading: 0, speed: 5, accuracy: 8,
  position_at: new Date(Date.now() + offset).toISOString(), updated_at: new Date(Date.now() + offset).toISOString() });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); vi.clearAllMocks(); mocks.signals.length = 0;
  vi.spyOn(Math, 'random').mockReturnValue(0);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
it('uses position_at instead of treating a fresh heartbeat as fresh GPS', () => {
  const old = driverPosition({ ...row(), position_at: new Date(Date.now() - 60_000).toISOString() });
  expect(freshFix(old)).toBe(false);
  expect(driverPosition(row())?.heading).toBe(0);
  expect(driverPosition({ ...row(), accuracy: 300 })).toBeNull();
  expect(driverPosition({ ...row(), position_at: 'invalid' })).toBeNull();
});
it('does not rewind Realtime with a late poll and recovers through a visible-page poll', async () => {
  let resolve!: (value: { data: Record<string, unknown> }) => void;
  const old = row();
  mocks.read.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = renderHook(() => useDriverPosition('driver-one'));
  act(() => mocks.apply?.({ new: row(1000) }));
  await act(async () => resolve({ data: old }));
  expect(view.result.current?.lng).toBe(25.01);
  mocks.read.mockResolvedValue({ data: row(2000) });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(view.result.current?.lng).toBe(25.02);
  view.unmount();
  expect(mocks.remove).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(30_000));
  expect(mocks.read).toHaveBeenCalledTimes(2);
});
it('expires a position at 45 seconds without waiting for another database record', () => {
  const gps = driverPosition(row());
  const view = renderHook(() => usePositionFreshness(gps));
  expect(view.result.current).toBe(true);
  act(() => vi.advanceTimersByTime(45_000));
  expect(view.result.current).toBe(false);
});

it('recovers a poll that never settles and ignores its late reply after the deadline', async () => {
  let done!: (value: unknown) => void;
  mocks.read.mockReset().mockReturnValueOnce(new Promise(resolve => { done = resolve; })).mockImplementation(async () => ({ data: row(), error: null }));
  const view = renderHook(() => useDriverPosition('driver-one'));
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  const current = view.result.current;
  expect(current?.timestamp).toBe(Date.now());
  await act(async () => done({ data: { ...row(), longitude: 99 } }));
  expect(view.result.current).toBe(current);
});
it('resumes after pageshow and cancels a pending poll on unmount', async () => {
  mocks.read.mockReset().mockImplementation(async () => ({ data: row(), error: null }));
  const view = renderHook(() => useDriverPosition('driver-one'));
  await act(async () => {});
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(mocks.read).toHaveBeenCalledTimes(2);
  mocks.read.mockImplementation(() => new Promise(() => {}));
  await act(async () => window.dispatchEvent(new Event('online')));
  const pendingSignal = mocks.signals.at(-1); view.unmount();
  expect(pendingSignal?.aborted).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(mocks.read).toHaveBeenCalledTimes(3);
});
