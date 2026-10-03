// @vitest-environment jsdom
import { act,cleanup,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { useNearbyCars,parseNearbyCars } from './useNearbyCars';
import { supabase } from '@/lib/supabase';
vi.mock('@/lib/supabase',()=>({supabase:{rpc:vi.fn()}}));
const token='a'.repeat(32),point={lat:43.35,lng:25.13};
let visibility='visible';
const data=()=>({cars:[{token,lat:point.lat,lng:point.lng,heading:0,speed:0,accuracy:20,position_at:new Date().toISOString(),updated_at:new Date().toISOString()}]});
const respond=(value:unknown)=>vi.mocked(supabase.rpc).mockReturnValue({abortSignal:()=>Promise.resolve({data:value,error:null})} as never);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));vi.clearAllMocks();visibility='visible';Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>visibility});respond(data());});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('limits preview reads to 15 seconds despite continuous GPS updates',async()=>{
 const view=renderHook(({origin})=>useNearbyCars(origin,'customer','type'),{initialProps:{origin:point}});
 await act(async()=>{});expect(view.result.current).toHaveLength(1);
 for(let n=1;n<=14;n++){act(()=>vi.advanceTimersByTime(1000));view.rerender({origin:{...point,lat:point.lat+n*.00001}});}
 expect(supabase.rpc).toHaveBeenCalledOnce();
 await act(async()=>vi.advanceTimersByTime(1000));expect(supabase.rpc).toHaveBeenCalledTimes(2);
 expect(supabase.rpc).toHaveBeenLastCalledWith('nearby_cars',expect.objectContaining({p_type:'type',p_lat:point.lat+14*.00001}));
});
it('makes no preview requests while hidden, signed out, missing a point or outside Bulgaria',async()=>{
 visibility='hidden';const view=renderHook(({origin,owner})=>useNearbyCars(origin,owner),{initialProps:{origin:null as typeof point|null,owner:undefined as string|undefined}});
 view.rerender({origin:point,owner:'customer'});await act(async()=>{});expect(supabase.rpc).not.toHaveBeenCalled();
 act(()=>{visibility='visible';document.dispatchEvent(new Event('visibilitychange'));});await act(async()=>{});expect(supabase.rpc).toHaveBeenCalledOnce();
 view.rerender({origin:{lat:48,lng:2},owner:'customer'});await act(async()=>vi.advanceTimersByTime(15000));expect(supabase.rpc).toHaveBeenCalledOnce();
});
it('expires original GPS positions after an error and never preserves fake available cars',async()=>{
 const view=renderHook(()=>useNearbyCars(point,'customer'));await act(async()=>{});
 vi.mocked(supabase.rpc).mockReturnValue({abortSignal:()=>Promise.reject(new Error('offline'))} as never);
 await act(async()=>vi.advanceTimersByTime(45000));expect(view.result.current).toEqual([]);
});
it('prevents overlapping requests and discards replies after owner/type changes',async()=>{
 let done!:(v:unknown)=>void;vi.mocked(supabase.rpc).mockReturnValue({abortSignal:()=>new Promise(resolve=>{done=resolve;})} as never);
 const view=renderHook(({type})=>useNearbyCars(point,'customer',type),{initialProps:{type:'old'}});
 await act(async()=>vi.advanceTimersByTime(30000));expect(supabase.rpc).toHaveBeenCalledOnce();
 respond(data());const oldDone=done;view.rerender({type:'new'});await act(async()=>{});
 const snapshot=view.result.current;await act(async()=>oldDone({data:{cars:[]},error:null}));expect(view.result.current).toBe(snapshot);
 view.unmount();await act(async()=>vi.advanceTimersByTime(60000));expect(supabase.rpc).toHaveBeenCalledTimes(2);
});
it('rejects invalid tokens, foreign or stale positions and caps the preview at 12',()=>{
 const car=data().cars[0];expect(parseNearbyCars({cars:[{...car,token:'driver-id'},{...car,lat:48,lng:2},{...car,position_at:'2020-01-01'},car,car]})).toHaveLength(1);
 expect(parseNearbyCars({cars:Array.from({length:20},(_,n)=>({...car,token:n.toString(16).padStart(32,'0')}))})).toHaveLength(12);
});
