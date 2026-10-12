// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import '@/i18n';
import DriverHome from './page';
import { queryKeys } from '@/lib/queryKeys';
const fake = vi.hoisted(() => ({
  driver: { id:'driver',user_id:'user',company_id:'company',is_online:false,is_verified:true,status:'offline' },
  change: vi.fn(), declined: new Set<string>(), accept: vi.fn(), incoming: [] as Array<Record<string, unknown>>,
  sound:vi.fn(),unlock:vi.fn(),register:vi.fn(),reads:vi.fn(),
  offersConnected: false, incomingReads: vi.fn(),
  activeRow:null as Record<string, unknown>|null,statuses:new Map<string,(status:string)=>void>(),filters:[] as Array<{table?:string;filter?:string}>,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user:{ id:'user',company_id:'company',role:'DRIVER',first_name:'Иван' },loading:false }) }));
vi.mock('@/hooks/useDriverOfferConnection', () => ({ useDriverOfferConnection: () => fake.offersConnected }));
vi.mock('@/lib/driverLocation', () => ({ setDriverOnline: fake.change, ensureDriverLocation: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/feature/DriverGpsProvider', () => ({ useDriverGps: () => ({ status:'idle',error:'' }) }));
vi.mock('@/hooks/useNotificationSound', () => ({ useNotificationSound: () => ({ unlockAudio:fake.unlock,playDriverSound:fake.sound }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register:fake.register }) }));
vi.mock('@/hooks/useDriverDeclines', () => ({ useDriverDeclines: () => ({ declinedIds:fake.declined,decline:vi.fn(),declineError:null,isDeclining:false,declinesReady:true,declinesLoadError:null,refreshDeclines:vi.fn() }) }));
vi.mock('@/components/feature/EnableNotificationsBanner', () => ({ default: () => null }));
vi.mock('@/lib/serverSummaries', () => ({ loadDriverDay: async () => ({ trips: 3, earnings: 12.50 }) }));
vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMaps: fake.register }));
vi.mock('@/lib/sharedGps', () => ({ getGpsPosition: () => null, subscribeGpsState: () => () => {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc:(...args:unknown[])=>({abortSignal:()=>args[0]==='driver_incoming_requests'?(fake.incomingReads(),Promise.resolve({data:fake.incoming,error:null})):fake.accept(...args)}),
  removeChannel:vi.fn(), channel: (name:string) => { const channel={
    on:(_event:string,filter:{table?:string;filter?:string})=>{fake.filters.push(filter);return channel;},
    subscribe:(status?:(status:string)=>void)=>{if(status)fake.statuses.set(name,status);return channel;},
  }; return channel; },
  from:(table:string) => {
    const query={select:()=>query,eq:()=>query,in:()=>query,order:()=>query,limit:()=>query,abortSignal:()=>query,
      maybeSingle:async()=>{fake.reads(table);return{data:table==='drivers'?fake.driver:fake.activeRow,error:null};},
      then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:fake.incoming,error:null}).then(resolve)};
    return query;
  },
} }));
afterEach(() => { cleanup();fake.incoming=[];fake.activeRow=null;fake.driver={...fake.driver,is_online:false,is_verified:true,status:'offline'};fake.change.mockReset();fake.register.mockReset();fake.filters=[];fake.statuses.clear();fake.offersConnected=false;fake.incomingReads.mockClear();vi.useRealTimers();vi.unstubAllGlobals(); });

it('uses private offer health for home reconciliation even when assigned updates remain connected', async () => {
  vi.useFakeTimers();fake.driver={...fake.driver,is_online:true,status:'available'};
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
  client.setQueryData(queryKeys.driverRecord('user'),fake.driver);client.setQueryData(queryKeys.driverActiveRequest('driver'),null);
  const content=()=> <QueryClientProvider client={client}><MemoryRouter><DriverHome /></MemoryRouter></QueryClientProvider>;
  const view=render(content());await act(async()=>vi.advanceTimersByTimeAsync(0));
  act(()=>fake.statuses.get('driver-requests-driver')?.('SUBSCRIBED'));
  await act(async()=>vi.advanceTimersByTimeAsync(0));fake.incomingReads.mockClear();
  await act(async()=>vi.advanceTimersByTimeAsync(8000));expect(fake.incomingReads).toHaveBeenCalledOnce();
  fake.offersConnected=true;view.rerender(content());fake.incomingReads.mockClear();
  await act(async()=>vi.advanceTimersByTimeAsync(29999));expect(fake.incomingReads).not.toHaveBeenCalled();
  await act(async()=>vi.advanceTimersByTimeAsync(1));expect(fake.incomingReads).toHaveBeenCalledOnce();client.clear();
});

function mount() {
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity},mutations:{retry:false}}});
  client.setQueryData(queryKeys.driverRecord('user'),fake.driver);
  client.setQueryData(queryKeys.driverActiveRequest('driver'),fake.activeRow);
  render(<QueryClientProvider client={client}><MemoryRouter><DriverHome /></MemoryRouter></QueryClientProvider>);
  return client;
}
it('keeps the map unloaded and changes the online action only after one confirmed write', async () => {
  vi.useFakeTimers(); let finish!:(value:unknown)=>void;
  fake.change.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  const client=mount();await act(async()=>vi.advanceTimersByTimeAsync(0));
  expect(fake.register).not.toHaveBeenCalled();
  const button=screen.getByRole('button',{name:'Включи онлайн'});
  fireEvent.click(button);fireEvent.click(button);
  await act(async()=>vi.advanceTimersByTimeAsync(0));expect(fake.change).toHaveBeenCalledOnce();
  expect(fake.change.mock.calls[0][1]).toBe(true);
  await act(async()=>{fake.driver={...fake.driver,is_online:true,status:'available'};finish(fake.driver);await vi.advanceTimersByTimeAsync(0);});
  expect(screen.getByRole('button',{name:'Излез офлайн'})).toBeTruthy();
  expect(screen.getByText('Стойност на курсовете')).toBeTruthy();client.clear();
});
it('directs an unverified offline driver to preparation and prevents online activation', async () => {
  vi.useFakeTimers();fake.driver={...fake.driver,is_verified:false};const client=mount();
  await act(async()=>vi.advanceTimersByTimeAsync(0));
  expect((screen.getByRole('button',{name:'Очаква верификация'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button',{name:'Продължи подготовката'})).toBeTruthy();
  expect(fake.change).not.toHaveBeenCalled();client.clear();
});
it('lets a driver go offline after verification is revoked while retaining the active trip entry', async () => {
  vi.useFakeTimers();fake.driver={...fake.driver,is_online:true,is_verified:false};
  fake.activeRow={id:'ride',status:'in_progress',pickup_address:'Начало',destination_address:'Край',estimated_price:10};
  fake.change.mockImplementation(async()=>{fake.driver={...fake.driver,is_online:false};return fake.driver;});
  const client=mount();await act(async()=>vi.advanceTimersByTimeAsync(0));
  const button=screen.getByRole('button',{name:'Излез офлайн'});expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole('button',{name:/Отвори текущия курс/})).toBeTruthy();
  fireEvent.click(button);await act(async()=>vi.advanceTimersByTimeAsync(0));
  expect(fake.change.mock.calls[0][1]).toBe(false);client.clear();
});

it('initialises the optional map once when opened and reuses it after collapsing', async () => {
  vi.useFakeTimers();const maps=vi.fn();
  class MapStub { constructor(){ maps(); } }
  vi.stubGlobal('google',{maps:{Map:MapStub,event:{clearInstanceListeners:vi.fn()}}});
  fake.register.mockResolvedValue(undefined);
  const client=mount();await act(async()=>vi.advanceTimersByTimeAsync(0));
  const details=screen.getByText('Карта').closest('details')!;
  const toggle=async(open:boolean)=>{await act(async()=>{details.open=open;fireEvent(details,new Event('toggle'));await vi.advanceTimersByTimeAsync(0);});};
  expect(maps).not.toHaveBeenCalled();await toggle(true);expect(maps).toHaveBeenCalledOnce();
  await toggle(false);await toggle(true);expect(maps).toHaveBeenCalledOnce();expect(fake.register).toHaveBeenCalledOnce();client.clear();
});

it('does not present a stale GPS session as ready to receive new requests', async () => {
  vi.useFakeTimers();fake.driver={...fake.driver,is_online:true,status:'available'};const client=mount();
  await act(async()=>vi.advanceTimersByTimeAsync(0));
  expect(screen.getByText('Изчаква GPS')).toBeTruthy();
  expect(screen.getByText(/не си достъпен за нови заявки/)).toBeTruthy();client.clear();
});

it('checks the request deadline again when clicking an offer after frozen browser timers',async()=>{
 vi.useFakeTimers();fake.driver={...fake.driver,is_online:true,status:'available'};
 fake.incoming=[{id:'request',status:'pending',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+10000).toISOString(),pickup_address:'Начало',destination_address:'Край',estimated_price:5}];
 const client=mount();await act(async()=>vi.advanceTimersByTimeAsync(0));
 const button=screen.getByRole('button',{name:/Приеми/});fake.accept.mockClear();
 vi.setSystemTime(Date.now()+11000);fireEvent.click(button);await act(async()=>vi.advanceTimersByTimeAsync(0));
 expect(fake.accept).not.toHaveBeenCalled();expect(screen.getByText(/Списъкът се обновява/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Излез офлайн'})).toBeTruthy();client.clear();
});
