// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import CustomerHome from './page';
import type { RouteResult } from '@/lib/googleMaps';
import { calculateFare } from '@/lib/pricing';
import { setLocationEnabled } from '@/lib/locationPreference';
import { stopSharedGps } from '@/lib/sharedGps';
import { defaultConsent, saveConsent } from '@/lib/cookieConsent';

const fake = vi.hoisted(() => ({
  counts: null as Record<string, number> | null,
  companies: ['company'],
  carriers: null as null | { company_id: string; vehicle_type_id: string; service_class: string }[],
  readById: vi.fn(), notify: null as null | ((payload: { new: Record<string, unknown> }) => void),
  rpc: vi.fn(), route: vi.fn(), reverse: vi.fn(), register: vi.fn(),
  active: null as Record<string, unknown> | null, recoveryError: false,
  vehicleTypes: [{ id: 'standard', name: 'Economy', capacity: 4, is_active: true, company_id:'company' }],
  user: { id: 'customer', company_id: 'company', first_name: 'Тест', email: 'test@example.test' },
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: fake.user, loading: false }) }));
vi.mock('@/hooks/usePushNotifications', () => ({ usePushNotifications: () => ({ register: fake.register }) }));
vi.mock('@/lib/googleMaps', () => ({ computeRoute: fake.route, reverseGeocode: fake.reverse }));
vi.mock('@/pages/customer/components/BookingMap', () => ({ default: () => <div>Map</div> }));
vi.mock('@/pages/customer/components/DriverTracking', () => ({ default: () => <div>Tracking</div> }));
vi.mock('@/components/feature/NotificationBell', () => ({ default: () => null }));
vi.mock('@/pages/customer/components/AppMenu', () => ({ default: () => null }));
vi.mock('@/lib/places', () => ({ hasPlacesApi: () => false }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => ({ abortSignal: () => args[0] === 'marketplace_availability' ? Promise.resolve({data:{company_id:'marketplace',sampled_at:new Date().toISOString(),categories:fake.vehicleTypes.map(v=>({id:v.id,drivers:fake.counts?.[v.id] ?? 1,configured:true})),carriers:fake.carriers ?? fake.companies.flatMap(company_id=>fake.vehicleTypes.filter(v=>(fake.counts?.[v.id] ?? 1)>0).map(v=>({company_id,vehicle_type_id:'type-'+v.id,service_class:v.id})))},error:null}) : args[0] === 'carrier_identity' ? Promise.resolve({data:null,error:null}) : fake.rpc(...args) }), removeChannel: vi.fn(),
  channel: () => { const channel = { on: (_event: string, _filter: unknown, callback: typeof fake.notify) => { fake.notify = callback; return channel; }, subscribe: () => channel }; return channel; },
  from: (table: string) => {
    const result = () => ({ data: table === 'taxi_requests' ? fake.active : table === 'companies' ? [{ id: 'company', name:'Тестова фирма' }]
      : fake.vehicleTypes,
    error: table === 'taxi_requests' && fake.recoveryError ? { message: 'offline' } : null });
    let byId = false;
    const query = { select: () => query, abortSignal: () => query, eq: (field: string) => { if (field === 'id') byId = true; return query; }, in: () => query, order: () => query,
      limit: () => query, maybeSingle: async () => table === 'taxi_requests' && byId ? fake.readById() : result(), then: (resolve: (data: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  },
} }));

const pickup = { id: 'a', name: 'Начало', address: 'ул. Иван Вазов 2, Левски', lat: 43.35, lng: 25.14 };
const destination = { id: 'b', name: 'Край', address: 'Гара, Левски', lat: 43.36, lng: 25.13 };
const offer = (cls='standard', id='quote', price=5, company='company') => ({vehicle_type_id:'type-'+cls,service_class:cls,company_id:company,
  company_name:company==='company'?'Тестова фирма':company,type_name:cls==='comfort'?'Комфорт':'Стандарт',capacity:4,quote_id:id,
  quote_expires_at:new Date(Date.now()+60000).toISOString(),price,breakdown:{...calculateFare({distanceKm:1.7,durationMin:5}),total:price}});
const quote = (): RouteResult => ({ success:true,...offer(),quotes:[offer()], distance_km:1.7,duration_min:5,duration_sec:300,polyline:'',legs:[],alternatives_count:0 });
const mount = async () => { const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><MemoryRouter><CustomerHome /></MemoryRouter></QueryClientProvider>); await act(async () => {}); };
const chooseRoute = async () => {
  fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
  fireEvent.click(screen.getByRole('button', { name: /Край/ }));
  await act(async () => { await vi.advanceTimersByTimeAsync(351); });
};

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); fake.counts=null; fake.carriers=null; fake.companies=['company']; fake.active = null; fake.recoveryError = false;
  fake.vehicleTypes = [{ id: 'standard', name: 'Economy', capacity: 4, is_active: true, company_id:'company' }];
  fake.readById.mockReset().mockImplementation(async () => ({ data: fake.active, error: null }));
  fake.notify = null;
  fake.route.mockResolvedValue(quote());
  fake.rpc.mockImplementation(async (...args: [string?, { p_request_id: string }?]) => {
    fake.active = { id: args[1]?.p_request_id ?? 'request', customer_id: fake.user.id,
      company_id: 'company', driver_id: null, status: 'pending', pickup_address: pickup.address,
      destination_address: destination.address, pickup_latitude: pickup.lat, pickup_longitude: pickup.lng,
      destination_latitude: destination.lat, destination_longitude: destination.lng, estimated_price: 5 };
    return { data: fake.active, error: null };
  });
  saveConsent({ ...defaultConsent(), functional: true });
  localStorage.setItem('leski_recent_locations', JSON.stringify([pickup, destination]));
});
afterEach(() => { cleanup(); stopSharedGps(); localStorage.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('customer booking integration', () => {
  it('gets a fresh quote and booking ID when ordering the same route after cancellation', async () => {
    await mount();await chooseRoute();
    fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));await act(async()=>{});
    const first=fake.rpc.mock.calls.find(call=>call[0]==='create_taxi_request')![1];
    fake.active={...fake.active,status:'cancelled'};
    act(()=>fake.notify?.({new:fake.active!}));
    fake.route.mockResolvedValue({...quote(),...offer('standard','next-quote'),quotes:[offer('standard','next-quote')]});
    fireEvent.click(screen.getByRole('button',{name:/Поръчай нова/}));
    expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
    await act(async()=>vi.advanceTimersByTimeAsync(351));
    expect(fake.route).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));await act(async()=>{});
    const writes=fake.rpc.mock.calls.filter(call=>call[0]==='create_taxi_request');
    expect(writes).toHaveLength(2);expect(writes[1][1].p_quote_id).toBe('next-quote');
    expect(writes[1][1].p_request_id).not.toBe(first.p_request_id);
  });
  it('switches category with no new routing call and books that category quote', async () => {
    fake.vehicleTypes.push({id:'comfort',name:'Comfort',capacity:4,is_active:true,company_id:'company'});
    const result = quote();
    result.quotes = ['standard','comfort'].map((id,i) => offer(id,`quote-${id}`,5+i));
    fake.route.mockResolvedValue(result);
    await mount(); await chooseRoute();
    fireEvent.change(screen.getByRole('combobox',{name:'Категория автомобил'}),{target:{value:'comfort'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(fake.route).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button',{name:/Поръчай каручка/}).textContent).toContain('6.00');
    fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));
    await act(async () => {});
    expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request',expect.objectContaining({p_quote_id:'quote-comfort'}));
  });
  it('expires all category offers together without silently buying another route', async () => {
    fake.vehicleTypes.push({id:'comfort',name:'Comfort',capacity:4,is_active:true,company_id:'company'});
    const result=quote();result.quotes=[offer('comfort','comfort-quote',6)];
    fake.route.mockResolvedValue(result); await mount(); await chooseRoute();
    fireEvent.change(screen.getByRole('combobox',{name:'Категория автомобил'}),{target:{value:'comfort'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.route).toHaveBeenCalledTimes(1);
  });
  it('moves straight from the two addresses to offers and sends one cash-only RPC on a double click', async () => {
    await mount();
    expect(screen.getByRole('heading', { name: 'Откъде тръгваш?' })).toBeTruthy();
    await chooseRoute();
    expect(screen.getByRole('heading', { name: 'Избери фирма.' })).toBeTruthy();
    const order = screen.getByRole('button', { name: /Поръчай каручка/ });
    fireEvent.click(order); fireEvent.click(order);
    await act(async () => {});
    expect(fake.rpc).toHaveBeenCalledTimes(1);
    expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request', expect.objectContaining({ p_payment_method: 'cash', p_quote_id: 'quote' }));
    expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
  });
  it('invalidates the old price immediately when addresses are swapped', async () => {
    await mount(); await chooseRoute();
    fake.route.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Размени адресите' }));
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it('allows address editing without losing the destination', async () => {
    await mount(); await chooseRoute();
    fireEvent.click(screen.getByRole('button', { name: '1. Откъде тръгваш?' }));
    fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
    expect(screen.getByRole('heading', { name: 'Избери фирма.' })).toBeTruthy();
  });
  it('treats browser offline as a hint, but disables ordering after quote expiry', async () => {
    await mount(); await chooseRoute();
    act(() => { window.dispatchEvent(new Event('offline')); });
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(false);
    act(() => { window.dispatchEvent(new Event('online')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect((screen.getByRole('button', { name: /Поръчай каручка/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Обнови цената');
  });
  it('blocks new booking until recovery succeeds and retries without reloading', async () => {
    fake.recoveryError = true; await mount();
    expect(screen.getByRole('alert').textContent).toContain('активна поръчка');
    expect(screen.queryByRole('searchbox')).toBeNull();
    fake.recoveryError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
    await act(async () => {});
    expect(screen.getByRole('searchbox')).toBeTruthy();
  });
  it('opens the existing request rather than offering a second booking', async () => {
    await fake.rpc(); fake.rpc.mockClear(); await mount();
    expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(fake.rpc).not.toHaveBeenCalled();
  });
});

it('keeps the accepted Realtime status when a slow earlier poll returns pending, with no overlapping reads', async () => {
  const pending = { id:'request',company_id:'company',driver_id:null,status:'pending',pickup_address:pickup.address,
    destination_address:destination.address,pickup_latitude:pickup.lat,pickup_longitude:pickup.lng,
    destination_latitude:destination.lat,destination_longitude:destination.lng,estimated_price:5,updated_at:'2026-10-03T18:00:00Z' };
  fake.active = pending;
  let finish!: (value: unknown) => void;
  fake.readById.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  await mount();
  expect(fake.readById).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  expect(fake.readById).toHaveBeenCalledTimes(1);
  act(() => fake.notify?.({ new:{ ...pending,status:'accepted',driver_id:'driver',updated_at:'2026-10-03T18:00:01Z' } }));
  expect(screen.getByText('Tracking')).toBeTruthy();
  await act(async () => finish({ data:pending,error:null }));
  expect(screen.getByText('Tracking')).toBeTruthy();
});

const gpsFix = (latitude = pickup.lat) => ({ timestamp: Date.now(), coords: { latitude, longitude: pickup.lng, accuracy: 10, heading: null, speed: 0 } } as GeolocationPosition);
const gpsBrowser = (permission: 'granted' | 'denied' | 'prompt' = 'granted') => {
  let receive!: (position: GeolocationPosition) => void;
  const get = vi.fn((cb: (position: GeolocationPosition) => void) => cb(gpsFix()));
  const watch = vi.fn((cb: typeof receive) => { receive = cb; return 9; });
  const query = vi.fn().mockResolvedValue({ state: permission });
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: get, watchPosition: watch, clearWatch: vi.fn() }, permissions: { query } });
  return { get, watch, query, move: (position: GeolocationPosition) => receive(position) };
};
it('uses remembered browser permission on opening and never moves chosen addresses on subsequent fixes', async () => {
  const browser = gpsBrowser(); fake.reverse.mockResolvedValue({ formatted_address: 'GPS адрес' });
  await mount();
  expect(browser.get).toHaveBeenCalledTimes(1);
  expect(browser.watch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem('leski:auto-location:customer')).toBe('on');
  expect(screen.getByRole('heading', { name: 'Накъде отиваш?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Край/ }));
  await act(async () => vi.advanceTimersByTimeAsync(351));
  expect(fake.route).toHaveBeenCalledTimes(1);
  await act(async () => browser.move(gpsFix(pickup.lat + .01)));
  await act(async () => vi.advanceTimersByTimeAsync(351));
  expect(fake.route).toHaveBeenCalledTimes(1); expect(fake.reverse).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('GPS адрес').length).toBeGreaterThan(0);
});
it('respects remembered off even if the browser still grants permission', async () => {
  const browser = gpsBrowser(); setLocationEnabled('customer', false);
  await mount();
  expect(browser.get).not.toHaveBeenCalled(); expect(browser.watch).not.toHaveBeenCalled();
});
it('does not ask for permission automatically on a first visit', async () => {
  const browser = gpsBrowser('prompt'); await mount();
  expect(browser.get).not.toHaveBeenCalled(); expect(browser.watch).not.toHaveBeenCalled();
});
it('cannot replace a manual pickup chosen while permission lookup was pending', async () => {
  const browser = gpsBrowser();
  let done!: (value: unknown) => void;
  browser.query.mockReturnValue(new Promise(resolve => { done = resolve; }));
  await mount(); fireEvent.click(screen.getByRole('button', { name: /Начало/ }));
  await act(async () => done({ state: 'granted' }));
  expect(browser.get).not.toHaveBeenCalled();
  expect(screen.getAllByText(pickup.address).length).toBeGreaterThan(0);
});
it('ignores a late reverse-geocoding result after location is turned off', async () => {
  gpsBrowser();
  let done!: (value: unknown) => void;
  fake.reverse.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  await mount();
  await act(async () => setLocationEnabled('customer', false));
  await act(async () => done({ formatted_address: 'GPS адрес' }));
  expect(screen.queryByText('GPS адрес')).toBeNull();
});

it('releases a stuck booking button and retries with the same request ID without accepting the late reply', async () => {
  let done!: (value: unknown) => void;
  fake.rpc.mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  await mount(); await chooseRoute();
  fireEvent.click(screen.getByRole('button', { name: /Поръчай каручка/ }));
  await act(async () => {});
  const first = fake.rpc.mock.calls[0][1];
  expect(document.querySelector<HTMLButtonElement>('button[aria-busy="true"]')?.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(15_000));
  expect(screen.getByRole('alert').textContent).toContain('Провери връзката');
  fireEvent.click(screen.getByRole('button', { name: /Поръчай каручка/ })); await act(async () => {});
  expect(fake.rpc).toHaveBeenCalledTimes(2);
  expect(fake.rpc.mock.calls[1][1].p_request_id).toBe(first.p_request_id);
  expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
  await act(async () => done({ data: { ...fake.active, status: 'cancelled' }, error: null }));
  expect(screen.getByRole('heading', { name: 'Търсим твоя шофьор' })).toBeTruthy();
});

it('does not offer Comfort without an eligible driver or create an empty booking', async () => {
  fake.vehicleTypes.push({id:'comfort',name:'Comfort',capacity:4,is_active:true,company_id:'company'});
  fake.counts={standard:1,comfort:0};await mount();await chooseRoute();
  expect((screen.getByRole('option',{name:/Комфорт/}) as HTMLOptionElement).disabled).toBe(true);
  expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(false);
  expect(fake.route).toHaveBeenCalledOnce();
});
it('explains no driver availability and prevents ordering despite a valid price', async () => {
  fake.counts={standard:0};await mount();await chooseRoute();
  expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/Сега няма свободен шофьор/)).toBeTruthy();
  expect(fake.rpc).not.toHaveBeenCalled();
});
it('reconciles a lost driver at submit without pretending that a request was created', async () => {
  await mount();await chooseRoute();
  fake.rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'NO_AVAILABLE_DRIVER: Няма свободен шофьор.'}});
  fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));
  await act(async()=>{});
  expect(screen.queryByRole('heading',{name:'Търсим твоя шофьор'})).toBeNull();
  expect(screen.getByRole('alert').textContent).toContain('няма свободен шофьор');
});
it('reuses the quoted route when nearby availability disappears and returns', async () => {
  await mount();await chooseRoute();expect(fake.route).toHaveBeenCalledOnce();
  fake.counts={standard:0};fireEvent.click(screen.getByRole('button',{name:'Обнови наличността'}));await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
  fake.counts={standard:1};fireEvent.click(screen.getByRole('button',{name:'Обнови наличността'}));await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(false);
  await act(async()=>vi.advanceTimersByTimeAsync(400));expect(fake.route).toHaveBeenCalledOnce();
});
it('requires an explicit price refresh when a newly available carrier was not quoted', async () => {
  await mount();await chooseRoute();
  fake.rpc.mockResolvedValueOnce({data:null,error:{code:'P0001',message:'QUOTE_FLEET_CHANGED: Наличните фирми са се променили. Обнови цената.'}});
  fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));await act(async()=>vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole('alert').textContent).toContain('Обнови цената');
  expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
  expect(fake.route).toHaveBeenCalledOnce();expect(screen.queryByRole('heading',{name:'Търсим твоя шофьор'})).toBeNull();
});

it('sorts exact named carrier offers cheapest first and books the explicitly selected carrier',async()=>{
 const result=quote();result.quotes=[offer('standard','expensive',51.76,'Такси Генади'),offer('standard','cheap',12.08,'Евро Такси')];
 fake.companies=['Такси Генади','Евро Такси'];fake.route.mockResolvedValue(result);await mount();await chooseRoute();
 const cards=screen.getAllByRole('radio');expect(cards[0].closest('label')!.textContent).toContain('Евро Такси');
 expect(screen.getByRole('button',{name:/Поръчай каручка/}).textContent).toContain('12.08');
 fireEvent.click(cards[1]);expect(screen.getByRole('button',{name:/Поръчай каручка/}).textContent).toContain('51.76');
 expect(screen.getByRole('button',{name:/Поръчай каручка/}).textContent).not.toContain('–');
 fireEvent.click(screen.getByRole('button',{name:/Поръчай каручка/}));await act(async()=>{});
 expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request',expect.objectContaining({p_quote_id:'expensive'}));expect(fake.route).toHaveBeenCalledOnce();
});
it('never substitutes a different carrier when a selected carrier disappears from refreshed quotes',async()=>{
 fake.companies=['company','Друга фирма'];
 const result=quote();result.quotes=[offer(),offer('standard','other',8,'Друга фирма')];fake.route.mockResolvedValue(result);
 await mount();await chooseRoute();fireEvent.click(screen.getAllByRole('radio')[0]);
 fake.route.mockImplementation(async()=>({...quote(),quotes:[offer('standard','other-new',8,'Друга фирма')]}));
 await act(async()=>vi.advanceTimersByTimeAsync(60000));fireEvent.click(screen.getByRole('button',{name:'Обнови офертите'}));
 await act(async()=>vi.advanceTimersByTimeAsync(351));expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
 expect(fake.rpc).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('radio'));
 expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(false);
});

it('keeps the selected category when its drivers disappear instead of switching to a different price',async()=>{
 fake.vehicleTypes.push({id:'comfort',name:'Comfort',capacity:4,is_active:true,company_id:'company'});
 fake.route.mockResolvedValue({...quote(),quotes:[offer(),offer('comfort','comfort',9)]});
 await mount();await chooseRoute();fake.counts={standard:0,comfort:1};
 fireEvent.click(screen.getByRole('button',{name:'Обнови наличността'}));await act(async()=>vi.advanceTimersByTimeAsync(1));
 expect(screen.getByRole('button',{name:/Поръчай каручка/}).textContent).toContain('5.00');
 expect((screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement).disabled).toBe(true);
 expect(fake.route).toHaveBeenCalledOnce();expect(fake.rpc).not.toHaveBeenCalled();
});

it('disables only the selected unavailable firm even while another firm in the same category has a car',async()=>{
 fake.companies=['company','Друга фирма'];
 fake.route.mockResolvedValue({...quote(),quotes:[offer(),offer('standard','other',8,'Друга фирма')]});
 await mount();await chooseRoute();
 fake.carriers=[{company_id:'Друга фирма',vehicle_type_id:'type-standard',service_class:'standard'}];
 fireEvent.click(screen.getByRole('button',{name:'Обнови наличността'}));await act(async()=>vi.advanceTimersByTimeAsync(1));
 const order=screen.getByRole('button',{name:/Поръчай каручка/}) as HTMLButtonElement;
 expect(order.disabled).toBe(true);expect(order.textContent).toContain('5.00');
 expect((screen.getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true);
 expect((screen.getAllByRole('radio')[0] as HTMLInputElement).disabled).toBe(true);
 expect(screen.getByText(/Тази фирма вече няма свободна кола/)).toBeTruthy();
 expect(fake.rpc).not.toHaveBeenCalled();
 fireEvent.click(screen.getAllByRole('radio')[1]);expect(order.disabled).toBe(false);expect(order.textContent).toContain('8.00');
 fireEvent.click(order);await act(async()=>{});
 expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request',expect.objectContaining({p_quote_id:'other'}));
 expect(fake.route).toHaveBeenCalledOnce();
});

it('names the selected firm during search and preserves a recovered route when it times out',async()=>{
 await fake.rpc();fake.rpc.mockClear();
 fake.active={...fake.active,fare_breakdown:{total:5,carrier_choice:{company_name:'ОРИОН'}}};
 await mount();expect(screen.getByRole('heading',{name:'Търсим шофьор от ОРИОН'})).toBeTruthy();
 fake.active={...fake.active,status:'cancelled',cancelled_by:'system'};
 act(()=>fake.notify?.({new:fake.active!}));
 expect(screen.getByText(/ОРИОН не прие заявката навреме/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Виж други оферти'}));
 await act(async()=>vi.advanceTimersByTimeAsync(351));
 expect(screen.getByRole('heading',{name:'Избери фирма.'})).toBeTruthy();
 expect(fake.route).toHaveBeenCalledWith(expect.objectContaining({address:pickup.address}),expect.objectContaining({address:destination.address}),expect.anything());
 expect(fake.rpc).not.toHaveBeenCalled();
});
