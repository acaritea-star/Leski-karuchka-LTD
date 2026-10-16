// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { driverPosition, useDriverPosition, usePositionFreshness } from './useDriverPosition';
import { freshFix } from '@/lib/vehicleMotion';
const mocks = vi.hoisted(() => ({ read: vi.fn(), remove: vi.fn(), signals: [] as AbortSignal[],
  apply: null as ((payload: { new: Record<string, unknown> }) => void) | null,
  system: null as ((payload: {extension:string;status:string}) => void) | null,
  status: null as ((status:string)=>void) | null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: (signal: AbortSignal) => { mocks.signals.push(signal); return { maybeSingle: mocks.read }; } }) }) }),
  channel: () => ({ on(event: string, _filter: unknown, apply: typeof mocks.apply | typeof mocks.system) {
    if(event==='system') mocks.system=apply as typeof mocks.system;else mocks.apply=apply as typeof mocks.apply;return this;
  }, subscribe(status:typeof mocks.status) { mocks.status=status;return this; } }),
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

it('keeps fast recovery until Postgres is listening and recovers extension errors on a connected socket',async()=>{
 mocks.read.mockReset().mockImplementation(async()=>({data:row(),error:null}));
 const view=renderHook(()=>useDriverPosition('driver-one'));await act(async()=>{});
 act(()=>mocks.status?.('SUBSCRIBED'));await act(async()=>vi.advanceTimersByTimeAsync(5000));
 expect(mocks.read).toHaveBeenCalledTimes(2);
 await act(async()=>mocks.system?.({extension:'postgres_changes',status:'ok'}));
 const healthy=mocks.read.mock.calls.length;
 await act(async()=>vi.advanceTimersByTimeAsync(14999));expect(mocks.read).toHaveBeenCalledTimes(healthy);
 await act(async()=>vi.advanceTimersByTimeAsync(1));expect(mocks.read).toHaveBeenCalledTimes(healthy+1);
 await act(async()=>mocks.system?.({extension:'postgres_changes',status:'error'}));
 const degraded=mocks.read.mock.calls.length;
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(mocks.read).toHaveBeenCalledTimes(degraded+1);
 expect(view.result.current?.timestamp).toBe(Date.now());
});
it('clears revoked GPS access but does not let an older empty poll erase a newer Realtime fix',async()=>{
 let finish!:(value:unknown)=>void;mocks.read.mockReset().mockReturnValueOnce(new Promise(resolve=>{finish=resolve;}));
 const view=renderHook(()=>useDriverPosition('driver-one'));
 act(()=>mocks.apply?.({new:row(1000)}));await act(async()=>finish({data:null,error:null}));
 expect(view.result.current?.lng).toBe(25.01);
 mocks.read.mockResolvedValue({data:null,error:null});await act(async()=>window.dispatchEvent(new Event('pageshow')));
 expect(view.result.current).toBeNull();
});
it('never exposes a previous driver or ride during the render that changes its scope',async()=>{
 mocks.read.mockReset().mockResolvedValue({data:row(),error:null});
 const seen:Array<ReturnType<typeof useDriverPosition>>=[];
 const view=renderHook(({id,scope,enabled})=>{const fix=useDriverPosition(id,enabled,scope);seen.push(fix);return fix;},
  {initialProps:{id:'driver-one',scope:'ride-one',enabled:true}});
 await act(async()=>{});expect(view.result.current).not.toBeNull();
 mocks.read.mockImplementation(()=>new Promise(()=>{}));
 for(const props of [{id:'driver-two',scope:'ride-one',enabled:true},{id:'driver-two',scope:'ride-two',enabled:true},{id:'driver-two',scope:'ride-two',enabled:false}]){
  seen.length=0;view.rerender(props);expect(seen.every(fix=>fix===null)).toBe(true);
 }
});
