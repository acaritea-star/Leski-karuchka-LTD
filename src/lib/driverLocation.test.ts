import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const { single, upsert } = vi.hoisted(() => ({single:vi.fn(),upsert:vi.fn()}));
vi.mock('@/lib/supabase', () => ({supabase:{from:()=>({upsert})}}));
import { startDriverGps, stopDriverGps, getGpsStats, isFreshTimestamp } from './driverLocation';

type PositionCallback = (position: GeolocationPosition) => void;
let watch: PositionCallback;
const fix = (lat=43.2): GeolocationPosition => ({timestamp:Date.now(),coords:{latitude:lat,longitude:25.6,accuracy:10,altitude:null,altitudeAccuracy:null,heading:null,speed:0}} as GeolocationPosition);
const flush = async () => {await vi.advanceTimersByTimeAsync(0);};
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T12:00:00Z'));
  const document = Object.assign(new EventTarget(),{visibilityState:'visible'});
  vi.stubGlobal('document',document);vi.stubGlobal('window',new EventTarget());
  vi.stubGlobal('navigator',{geolocation:{watchPosition:vi.fn((cb:PositionCallback)=>{watch=cb;return 1;}),clearWatch:vi.fn(),getCurrentPosition:vi.fn((cb:PositionCallback)=>cb(fix()))}});
  upsert.mockReset().mockReturnValue({select:()=>({abortSignal:()=>({single})})});
  single.mockReset().mockImplementation(async()=>({data:{updated_at:new Date().toISOString()},error:null}));
});
afterEach(()=>{stopDriverGps();vi.unstubAllGlobals();vi.useRealTimers();});

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
  it('handles Supabase resolved errors and immediately retries the next fix',async()=>{
    single.mockResolvedValueOnce({data:null,error:{message:'RLS denied'}});
    const success=vi.fn(),error=vi.fn();startDriverGps('driver','company',{onUpdate:success,onError:error});
    watch(fix());await flush();expect(error).toHaveBeenCalledWith('RLS denied');expect(success).not.toHaveBeenCalled();
    watch(fix());await flush();expect(success).toHaveBeenCalledTimes(1);
  });
  it('does not refresh the timestamp with an old GPS fix',async()=>{
    startDriverGps('driver','company');watch({...fix(),timestamp:Date.now()-60000});await flush();
    expect(single).not.toHaveBeenCalled();expect(getGpsStats().error).toContain('остаряла');
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
