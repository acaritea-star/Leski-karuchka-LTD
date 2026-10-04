// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '@/i18n';
import DriverRequests from './page';
import { queryKeys } from '@/lib/queryKeys';
const fake = vi.hoisted(() => ({
  driver: { id:'driver',user_id:'user',company_id:'company',is_online:false,is_verified:true,status:'offline' },
  change: vi.fn(), declined: new Set<string>(), accept: vi.fn(), incoming: [] as Array<Record<string, unknown>>,
  sound:vi.fn(),unlock:vi.fn(),register:vi.fn(),reads:vi.fn(),
  statuses:new Map<string,(status:string)=>void>(),filters:[] as Array<{table?:string;filter?:string}>,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user:{ id:'user',company_id:'company',role:'DRIVER' } }) }));
vi.mock('@/lib/driverLocation', () => ({ setDriverOnline: fake.change }));
vi.mock('@/components/feature/DriverGpsProvider', () => ({ useDriverGps: () => ({ status:'idle',error:'' }) }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ unlockAudio:fake.unlock,playDriverSound:fake.sound }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register:fake.register }) }));
vi.mock('@/hooks/useDriverDeclines', () => ({ useDriverDeclines: () => ({ declinedIds:fake.declined,decline:vi.fn(),declineError:null,isDeclining:false }) }));
vi.mock('@/pages/driver/components/DriverRouteMap', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc:(...args:unknown[])=>({abortSignal:()=>fake.accept(...args)}),
  removeChannel:vi.fn(), channel: (name:string) => { const channel={
    on:(_event:string,filter:{table?:string;filter?:string})=>{fake.filters.push(filter);return channel;},
    subscribe:(status?:(status:string)=>void)=>{if(status)fake.statuses.set(name,status);return channel;},
  }; return channel; },
  from:(table:string) => {
    const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,limit:()=>query,abortSignal:()=>query,
      maybeSingle:async()=>{fake.reads(table);return{data:table==='drivers'?fake.driver:null,error:null};},
      then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:fake.incoming,error:null}).then(resolve)};
    return query;
  },
} }));
afterEach(() => { cleanup();fake.incoming=[];fake.filters=[];fake.statuses.clear();vi.useRealTimers(); });
it('keeps the original online intent through a retry after the driver cache changes, and blocks duplicate clicks', async () => {
  vi.useFakeTimers(); fake.driver={...fake.driver,is_online:false,status:'offline'};fake.change.mockReset();
  fake.change.mockRejectedValueOnce(new Error('Acknowledgement lost')).mockImplementation(async()=>fake.driver);
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:1,retryDelay:100}}});
  client.setQueryData(queryKeys.driverRecord('user'),fake.driver);
  render(<QueryClientProvider client={client}><MemoryRouter><DriverRequests /></MemoryRouter></QueryClientProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  const online=screen.getByRole('button',{name:'Включи се онлайн'});
  fireEvent.click(online);fireEvent.click(online);
  await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(fake.change).toHaveBeenCalledTimes(1);
  act(()=>{fake.driver={...fake.driver,is_online:true,status:'available'};client.setQueryData(queryKeys.driverRecord('user'),fake.driver);});
  await act(async()=>{await vi.advanceTimersByTimeAsync(500);});
  expect(fake.change).toHaveBeenCalledTimes(2);
  expect(fake.change.mock.calls.map(call=>call[1])).toEqual([true,true]);
  client.clear();
});
it('releases a hung accept after the deadline, blocks duplicate clicks, and ignores its late reply', async () => {
  vi.useFakeTimers();fake.driver={...fake.driver,is_online:true,status:'available'};
  fake.incoming=[{id:'request',company_id:'company',status:'pending',pickup_address:'Тест начало',destination_address:'Тест край',
    pickup_latitude:43.2,pickup_longitude:25.6,destination_latitude:43.21,destination_longitude:25.61,
    estimated_price:5,estimated_distance_km:2,estimated_duration_min:5,created_at:new Date().toISOString()}];
  let finish!:(value:unknown)=>void;fake.accept.mockReset().mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
  client.setQueryData(queryKeys.driverRecord('user'),fake.driver);client.setQueryData(queryKeys.driverActiveRequest('driver'),null);
  render(<QueryClientProvider client={client}><MemoryRouter><DriverRequests /></MemoryRouter></QueryClientProvider>);
  await act(async()=>vi.advanceTimersByTimeAsync(0));
  const accept=screen.getByRole('button',{name:'Приеми'});fireEvent.click(accept);fireEvent.click(accept);
  await act(async()=>vi.advanceTimersByTimeAsync(0));expect(fake.accept).toHaveBeenCalledOnce();
  await act(async()=>vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByText('Връзката се забави. Опитай отново.')).toBeTruthy();
  expect((screen.getByRole('button',{name:'Приеми'}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>finish({data:{id:'request',status:'accepted',driver_id:'driver'},error:null}));
  expect(client.getQueryData(queryKeys.driverActiveRequest('driver'))).toBeNull();client.clear();
});
it('reconciles the active ride slowly on a healthy socket and every eight seconds after disconnect', async () => {
  vi.useFakeTimers();fake.reads.mockClear();fake.driver={...fake.driver,is_online:false,status:'offline'};
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData(queryKeys.driverRecord('user'),fake.driver);client.setQueryData(queryKeys.driverActiveRequest('driver'),null);
  render(<QueryClientProvider client={client}><MemoryRouter><DriverRequests /></MemoryRouter></QueryClientProvider>);
  await act(async()=>vi.advanceTimersByTimeAsync(0));
  act(()=>fake.statuses.get('driver-requests-panel-driver')?.('SUBSCRIBED'));
  await act(async()=>vi.advanceTimersByTimeAsync(29_999));expect(fake.reads).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(fake.reads).toHaveBeenCalledWith('taxi_requests');
  expect(fake.filters.filter(f=>f.table==='taxi_requests').every(f=>!!f.filter)).toBe(true);
  fake.reads.mockClear();act(()=>fake.statuses.get('driver-requests-panel-driver')?.('CHANNEL_ERROR'));
  await act(async()=>vi.advanceTimersByTimeAsync(8000));expect(fake.reads).toHaveBeenCalledOnce();client.clear();
});
