import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { single, upsert, update, updateSingle, readDriver } = vi.hoisted(() => ({single:vi.fn(),upsert:vi.fn(),update:vi.fn(),updateSingle:vi.fn(),readDriver:vi.fn()}));
vi.mock('@/lib/supabase', () => ({supabase:{from:()=>({upsert,update,select:()=>({eq:()=>({abortSignal:()=>({maybeSingle:readDriver})})})})}}));
import { stopSharedGps } from './sharedGps';
import { startDriverGps, stopDriverGps, getGpsStats, GPS_STALE_MS, isFreshTimestamp, setDriverOnline } from './driverLocation';

type PositionCallback = (position: GeolocationPosition) => void;
let watch: PositionCallback;
const fix = (lat=43.2): GeolocationPosition => ({timestamp:Date.now(),coords:{latitude:lat,longitude:25.6,accuracy:10,altitude:null,altitudeAccuracy:null,heading:null,speed:0}} as GeolocationPosition);
const flush = async () => {await vi.advanceTimersByTimeAsync(0);};
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
  const document = Object.assign(new EventTarget(),{visibilityState:'visible'});
  vi.stubGlobal('document',document);vi.stubGlobal('window',new EventTarget());
  vi.stubGlobal('navigator',{geolocation:{watchPosition:vi.fn((cb:PositionCallback)=>{watch=cb;return 1;}),clearWatch:vi.fn(),getCurrentPosition:vi.fn((cb:PositionCallback)=>cb(fix()))}});
  update.mockReset().mockReturnValue({eq:()=>({select:()=>({abortSignal:()=>({single:updateSingle})})})});
  readDriver.mockReset().mockResolvedValue({data:null,error:null});
  updateSingle.mockReset().mockResolvedValue({data:{id:'driver',company_id:'company',is_online:false,status:'offline'},error:null});
  upsert.mockReset().mockReturnValue({select:()=>({abortSignal:()=>({single})})});
  single.mockReset().mockImplementation(async()=>({data:{updated_at:new Date().toISOString()},error:null}));
});
afterEach(()=>{stopDriverGps();stopSharedGps();vi.unstubAllGlobals();vi.useRealTimers();});

describe('driver GPS writes',()=>{
  it('writes an idle heartbeat after 15 seconds even with identical coordinates',async()=>{
    startDriverGps('driver','company');watch(fix());await flush();
    expect(single).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(single).toHaveBeenCalledTimes(2);
    expect(getGpsStats().lastWriteAgeMs).toBe(0);
  });
  it('does not call success on throttled GPS callbacks',async()=>{
    const success=vi.fn();startDriverGps('driver','company',{onUpdate:success});
    watch(fix());await flush();watch(fix(43.3));await flush();
    expect(success).toHaveBeenCalledTimes(1);
  });
  it('backs off resolved errors instead of retrying every GPS callback',async()=>{
    single.mockResolvedValueOnce({data:null,error:{message:'RLS denied'}});
    const success=vi.fn(),error=vi.fn();startDriverGps('driver','company',{onUpdate:success,onError:error});
    watch(fix());await flush();expect(error).toHaveBeenCalledWith('RLS denied');expect(success).not.toHaveBeenCalled();
    watch(fix());await flush();expect(success).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);expect(success).toHaveBeenCalledTimes(1);
  });
  it('does not refresh the timestamp with an old GPS fix',async()=>{
    startDriverGps('driver','company');watch({...fix(),timestamp:Date.now()-60000});await flush();
    expect(single).not.toHaveBeenCalled();expect(getGpsStats().error).toContain('остаряла');
  });
  it('rejects a location too imprecise for dispatch without claiming a successful write',async()=>{
    const onUpdate=vi.fn(),onError=vi.fn();startDriverGps('driver','company',{onUpdate,onError});
    const coarse={...fix(),coords:{...fix().coords,accuracy:101}};
    watch(coarse);await flush();
    expect(upsert).not.toHaveBeenCalled();expect(onUpdate).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Неточна'));
    watch(fix());await flush();expect(onUpdate).toHaveBeenCalledTimes(1);
  });
  it('allows only one write in flight',async()=>{
    let resolve!: (value:unknown)=>void;single.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    startDriverGps('driver','company');watch(fix());watch(fix(43.3));expect(single).toHaveBeenCalledTimes(1);
    resolve({data:{updated_at:new Date().toISOString()},error:null});await flush();
  });
  it('ignores a write acknowledgement from a stopped session',async()=>{
    let resolve!: (value:unknown)=>void;single.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
    const success=vi.fn();startDriverGps('old','company',{onUpdate:success});watch(fix());stopDriverGps();
    resolve({data:{updated_at:new Date().toISOString()},error:null});await flush();
    expect(success).not.toHaveBeenCalled();expect(getGpsStats().running).toBe(false);
  });
  it('stops the watcher and heartbeat on logout/unmount',async()=>{
    startDriverGps('driver','company');stopDriverGps();await vi.advanceTimersByTimeAsync(60000);
    expect(navigator.geolocation.clearWatch).toHaveBeenCalledWith(1);expect(single).not.toHaveBeenCalled();
  });
  it('does not request a fake heartbeat from a hidden document',async()=>{
    startDriverGps('driver','company');Object.assign(document,{visibilityState:'hidden'});
    await vi.advanceTimersByTimeAsync(15000);expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
describe('location freshness',()=>{
 it('uses the original database timestamp on repeated reads',()=>{
   const stamp=new Date().toISOString();expect(isFreshTimestamp(stamp)).toBe(true);
   vi.advanceTimersByTime(46000);expect(isFreshTimestamp(stamp)).toBe(false);
 });
 it('rejects absent, invalid, and far future timestamps',()=>{
   expect(isFreshTimestamp(null)).toBe(false);expect(isFreshTimestamp('bad')).toBe(false);
   expect(isFreshTimestamp(new Date(Date.now()+120000).toISOString())).toBe(false);
 });
});

it('rejects GPS outside Bulgaria without writing to the database', async () => {
  const onError=vi.fn();startDriverGps('driver','company',{onError});
  watch({...fix(),coords:{...fix().coords,latitude:51.507,longitude:-.128}});await flush();
  expect(upsert).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('България'));
});

it('allows going offline without a GPS prompt and returns the confirmed status immediately', async () => {
  const confirmed = await setDriverOnline({ id:'driver',company_id:'company' }, false);
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
  expect(upsert).not.toHaveBeenCalled();
  expect(confirmed).toMatchObject({ is_online:false,status:'offline' });
});
it('does not confirm an online change rejected by the server', async () => {
  updateSingle.mockResolvedValueOnce({ data:null,error:{message:'Online unavailable'} });
  await expect(setDriverOnline({ id:'driver',company_id:'company' }, true)).rejects.toThrow('Online unavailable');
  expect(upsert).toHaveBeenCalledTimes(1);
});

it('retains only the latest GPS fix during a slow write and flushes it without overlapping writes', async () => {
  let done!: (value: unknown) => void;
  single.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  startDriverGps('driver', 'company'); const first = fix(); watch(first);
  await vi.advanceTimersByTimeAsync(1000); watch(fix(43.3));
  await vi.advanceTimersByTimeAsync(1000); const latest = fix(43.4); watch(latest);
  expect(single).toHaveBeenCalledOnce();
  done({ data: { updated_at: new Date().toISOString() }, error: null }); await flush();
  expect(single).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);
  expect(single).toHaveBeenCalledTimes(2);
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ latitude: 43.4, position_at: new Date(latest.timestamp).toISOString() }), expect.anything());
  expect(getGpsStats().lastConfirmedFixAgeMs).toBe(3000);
});
it('recovers after a transport that ignores abort and keeps the newest fix during backoff', async () => {
  single.mockReturnValueOnce(new Promise(() => {}));
  const success = vi.fn(); startDriverGps('driver', 'company', { onUpdate: success }); watch(fix());
  await vi.advanceTimersByTimeAsync(15_000);
  expect(getGpsStats().error).toContain('забави'); expect(success).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const newer = fix(43.4); watch(newer);
  await vi.advanceTimersByTimeAsync(4999);
  expect(single).toHaveBeenCalledTimes(2); expect(success).toHaveBeenCalledOnce();
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ latitude: 43.4 }), expect.anything());
});
it('backs off repeated network failures instead of writing for every new native fix', async () => {
  single.mockResolvedValue({ data: null, error: { message: 'No connection' } });
  startDriverGps('driver', 'company'); watch(fix()); await flush();
  for (let second = 1; second <= 14; second++) { await vi.advanceTimersByTimeAsync(1000); watch(fix()); await flush(); }
  expect(single).toHaveBeenCalledTimes(2); // Initial attempt, then after 5 seconds.
  await vi.advanceTimersByTimeAsync(1000); expect(single).toHaveBeenCalledTimes(3);
});
it('aborts an in-flight write on stop and never uploads a queued location later', async () => {
  let signal!: AbortSignal;
  upsert.mockReturnValue({ select: () => ({ abortSignal: (abort: AbortSignal) => { signal = abort; return { single }; } }) });
  single.mockReturnValueOnce(new Promise(() => {}));
  startDriverGps('driver', 'company'); watch(fix());
  await vi.advanceTimersByTimeAsync(1000); watch(fix(43.3));
  stopDriverGps(); expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000); expect(single).toHaveBeenCalledOnce();
});
it('requires a fresh GPS source as well as a fresh server acknowledgement', async () => {
  let done!: (value: unknown) => void;
  single.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  startDriverGps('driver', 'company'); watch({ ...fix(), timestamp: Date.now() - 29_000 });
  await vi.advanceTimersByTimeAsync(14_000);
  done({ data: { updated_at: new Date().toISOString() }, error: null }); await flush();
  expect(getGpsStats().lastWriteAgeMs).toBe(0);
  expect(getGpsStats().lastConfirmedFixAgeMs).toBe(43_000);
  Object.assign(document, { visibilityState: 'hidden' });
  await vi.advanceTimersByTimeAsync(3000);
  expect(getGpsStats().lastConfirmedFixAgeMs).toBeGreaterThan(GPS_STALE_MS);
  expect(getGpsStats().lastWriteAgeMs).toBe(3000);
});
it('discards queued stale fixes rather than replaying an offline journey', async () => {
  single.mockResolvedValue({ data: null, error: { message: 'offline' } });
  startDriverGps('driver', 'company'); watch(fix()); await flush();
  Object.assign(document, { visibilityState: 'hidden' });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(single).toHaveBeenCalledOnce();
  single.mockImplementation(async () => ({ data: { updated_at: new Date().toISOString() }, error: null }));
  Object.assign(document, { visibilityState: 'visible' }); window.dispatchEvent(new Event('pageshow'));
  await flush(); expect(single).toHaveBeenCalledTimes(2);
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ position_at: new Date().toISOString() }), expect.anything());
});

it('confirms offline after a lost acknowledgement without repeating the write or requesting GPS', async () => {
  updateSingle.mockRejectedValueOnce(new TypeError('Lost acknowledgement'));
  readDriver.mockResolvedValueOnce({data:{id:'driver',company_id:'company',is_online:false,status:'offline'},error:null});
  await expect(setDriverOnline({id:'driver',company_id:'company'},false)).resolves.toMatchObject({is_online:false});
  expect(update).toHaveBeenCalledOnce();expect(readDriver).toHaveBeenCalledOnce();
  expect(navigator.geolocation.getCurrentPosition).not.toHaveBeenCalled();
});
it('reduces idle GPS noise to a fresh fifteen-second heartbeat', async () => {
  startDriverGps('driver','company');watch(fix());await flush();
  for(let second=1;second<=30;second++) {
    await vi.advanceTimersByTimeAsync(1000);
    watch(fix(43.2+(second%2)*0.00001));await flush();
  }
  expect(single).toHaveBeenCalledTimes(3); // Initial + 15s + 30s, not every 5s.
  expect(getGpsStats().lastConfirmedFixAgeMs).toBeLessThan(1001);
});
it('shortens an idle deadline as soon as real movement resumes', async () => {
  startDriverGps('driver','company');watch(fix());await flush();
  await vi.advanceTimersByTimeAsync(4000);watch(fix());await flush();
  expect(single).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1000);
  watch({...fix(43.2003),coords:{...fix(43.2003).coords,speed:8}});await flush();
  expect(single).toHaveBeenCalledTimes(2);
});
