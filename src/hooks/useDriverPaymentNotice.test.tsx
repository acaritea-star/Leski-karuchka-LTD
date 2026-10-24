// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Tables } from '@/lib/database.types';
import { cacheDriverRequest } from '@/lib/driverRequestCache';
import { useDriverPaymentNotice } from './useDriverPaymentNotice';
const fake=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,abortSignal:()=>q,maybeSingle:fake.read};return q;}}}));
const row=(id:string,status='completed',payment_status='paid')=>({id,driver_id:'driver',status,payment_status,payment_method:'online',payment_environment:'live',updated_at:'2026-10-23T20:00:00Z'}) as Tables<'taxi_requests'>;
function setup(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=renderHook(({owner,driver,id}:{owner:string;driver:string;id?:string})=>useDriverPaymentNotice(owner,driver,id),{
  initialProps:{owner:'owner',driver:'driver',id:'A' as string|undefined},wrapper:({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
 return {client,...view};
}
beforeEach(()=>{vi.clearAllMocks();fake.read.mockResolvedValue({data:row('A'),error:null});});
afterEach(cleanup);
it('uses the exact Realtime receipt without another database request and clears it for the next ride',async()=>{
 const view=setup();act(()=>cacheDriverRequest(view.client,'driver',row('A')));
 view.rerender({owner:'owner',driver:'driver',id:undefined});
 await waitFor(()=>expect(view.result.current).toBe('Платено онлайн'));expect(fake.read).not.toHaveBeenCalled();
 view.rerender({owner:'owner',driver:'driver',id:'B'});expect(view.result.current).toBe('');
});
it('reads only the previous ride when a terminal Realtime event was missed, even with an older cached active row',async()=>{
 const view=setup();act(()=>cacheDriverRequest(view.client,'driver',row('A','in_progress','pending')));
 view.rerender({owner:'owner',driver:'driver',id:undefined});
 await waitFor(()=>expect(view.result.current).toBe('Платено онлайн'));expect(fake.read).toHaveBeenCalledOnce();
});
it('does not leak another owner or driver notice and hides a subsequently refunded receipt',async()=>{
 const view=setup();act(()=>cacheDriverRequest(view.client,'driver',row('A')));
 view.rerender({owner:'owner',driver:'driver',id:undefined});await waitFor(()=>expect(view.result.current).toBe('Платено онлайн'));
 act(()=>cacheDriverRequest(view.client,'driver',{...row('A','completed','refunded'),updated_at:'2026-10-23T20:01:00Z'}));
 await waitFor(()=>expect(view.result.current).toBe(''));
 view.rerender({owner:'other',driver:'other-driver',id:undefined});expect(view.result.current).toBe('');expect(fake.read).not.toHaveBeenCalled();
});
it('cannot turn a late response from A into a paid notice for B',async()=>{
 let resolve!:(value:unknown)=>void;fake.read.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=setup();
 view.rerender({owner:'owner',driver:'driver',id:undefined});await waitFor(()=>expect(fake.read).toHaveBeenCalledOnce());
 view.rerender({owner:'owner',driver:'driver',id:'B'});await act(async()=>resolve({data:row('A'),error:null}));expect(view.result.current).toBe('');
});

it('does not let a slow receipt read overwrite a newer refund event',async()=>{
 let resolve!:(value:unknown)=>void;fake.read.mockImplementation(()=>new Promise(r=>{resolve=r;}));const view=setup();
 view.rerender({owner:'owner',driver:'driver',id:undefined});await waitFor(()=>expect(fake.read).toHaveBeenCalledOnce());
 act(()=>cacheDriverRequest(view.client,'driver',{...row('A','completed','refunded'),updated_at:'2026-10-23T20:01:00Z'}));
 await act(async()=>resolve({data:row('A'),error:null}));expect(view.result.current).toBe('');
});
