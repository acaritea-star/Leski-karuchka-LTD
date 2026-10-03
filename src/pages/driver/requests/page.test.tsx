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
  change: vi.fn(), declined: new Set<string>(),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user:{ id:'user',company_id:'company',role:'DRIVER' } }) }));
vi.mock('@/lib/driverLocation', () => ({ setDriverOnline: fake.change }));
vi.mock('@/components/feature/DriverGpsProvider', () => ({ useDriverGps: () => ({ status:'idle',error:'' }) }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ unlockAudio:vi.fn(),playDriverSound:vi.fn() }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register:vi.fn() }) }));
vi.mock('@/hooks/useDriverDeclines', () => ({ useDriverDeclines: () => ({ declinedIds:fake.declined,decline:vi.fn(),declineError:null,isDeclining:false }) }));
vi.mock('@/pages/driver/components/DriverRouteMap', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  removeChannel:vi.fn(), channel: () => { const channel={ on:()=>channel,subscribe:()=>channel }; return channel; },
  from:(table:string) => {
    const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,limit:()=>query,
      maybeSingle:async()=>({data:table==='drivers'?fake.driver:null,error:null}),
      then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};
    return query;
  },
} }));
afterEach(() => { cleanup();vi.useRealTimers(); });
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
