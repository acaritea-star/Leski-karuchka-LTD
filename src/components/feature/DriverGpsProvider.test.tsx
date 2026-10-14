// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({
 user:{id:'driver-user',role:'DRIVER'},driver:{id:'driver',user_id:'driver-user',company_id:'company',is_online:true},
 callbacks:null as null | {onUpdate:()=>void;onError:(error:string,recoverable?:boolean)=>void},
 stats:{lastWriteAgeMs:Infinity,lastConfirmedFixAgeMs:Infinity,error:''},
 start:vi.fn(),stop:vi.fn(),probe:vi.fn(),
}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:fake.user})}));
vi.mock('@/hooks/useLocationPreference',()=>({useLocationPreference:()=>true}));
vi.mock('@/lib/locationPreference',()=>({getLocationEnabled:()=>true,setLocationEnabled:vi.fn()}));
vi.mock('@/lib/sharedGps',()=>({gpsPermission:async()=>'denied',getGpsPosition:()=>null,requestGps:vi.fn(),stopSharedGps:vi.fn()}));
vi.mock('@/lib/driverRecord',()=>({driverRecordOptions:(id:string)=>({queryKey:['driver-test',id],queryFn:async()=>fake.driver,staleTime:Infinity})}));
vi.mock('@/lib/driverLocation',()=>({GPS_STALE_MS:45000,getGpsStats:()=>({...fake.stats,confirmed:fake.stats.lastWriteAgeMs<90000&&fake.stats.lastConfirmedFixAgeMs<90000}),
 startDriverGps:(id:string,company:string,callbacks:typeof fake.callbacks)=>{fake.callbacks=callbacks;fake.start(id,company);},
 stopDriverGps:fake.stop,ensureDriverLocation:vi.fn().mockResolvedValue(undefined)}));
import DriverGpsProvider,{useDriverGps} from './DriverGpsProvider';
function Probe(){const gps=useDriverGps();fake.probe();return <div><output data-testid="state">{gps.status}</output><p role="status">{gps.message}</p>{gps.error&&<p role="alert">{gps.error}</p>}</div>;}
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});client.setQueryData(['driver-test','driver-user'],fake.driver);
 render(<QueryClientProvider client={client}><DriverGpsProvider><Probe /></DriverGpsProvider></QueryClientProvider>);return client;}
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();fake.stats={lastWriteAgeMs:Infinity,lastConfirmedFixAgeMs:Infinity,error:''};
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});
afterEach(()=>{cleanup();vi.useRealTimers();});
it('shows acquisition instead of a red error for an initial coarse fix and goes green only after a confirmed write',async()=>{
 const client=mount();expect(screen.getByTestId('state').textContent).toBe('acquiring');expect(screen.queryByRole('alert')).toBeNull();
 act(()=>fake.callbacks!.onError('Уточняваме GPS',true));await act(async()=>vi.advanceTimersByTimeAsync(10000));
 expect(screen.getByTestId('state').textContent).toBe('acquiring');expect(screen.queryByRole('alert')).toBeNull();
 fake.stats={lastWriteAgeMs:0,lastConfirmedFixAgeMs:0,error:''};act(()=>fake.callbacks!.onUpdate());
 expect(screen.getByTestId('state').textContent).toBe('tracking');expect(screen.queryByRole('alert')).toBeNull();client.clear();
});
it('keeps an unsuccessful acquisition unavailable after its deadline without presenting it as an online driver',async()=>{
 const client=mount();await act(async()=>vi.advanceTimersByTimeAsync(25000));
 expect(screen.getByTestId('state').textContent).toBe('stale');expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByText(/Още няма потвърдена позиция/)).toBeTruthy();client.clear();
});
it('shows permission denial immediately and never hides it behind the acquisition grace period',async()=>{
 const client=mount();act(()=>fake.callbacks!.onError('Разреши достъп до местоположението от настройките на браузъра.'));
 await act(async()=>vi.advanceTimersByTimeAsync(10000));expect(screen.getByTestId('state').textContent).toBe('error');
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});act(()=>document.dispatchEvent(new Event('visibilitychange')));
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});act(()=>window.dispatchEvent(new Event('pageshow')));
 expect(screen.getByRole('alert').textContent).toContain('Разреши');client.clear();
});
it('does not repaint driver consumers for repeated healthy GPS acknowledgements',()=>{
 const client=mount();fake.stats={lastWriteAgeMs:0,lastConfirmedFixAgeMs:0,error:''};act(()=>fake.callbacks!.onUpdate());const renders=fake.probe.mock.calls.length;
 act(()=>{for(let i=0;i<100;i++)fake.callbacks!.onUpdate();});expect(fake.probe).toHaveBeenCalledTimes(renders);client.clear();
});
it('restores a still-confirmed position after a brief switch between browser windows',()=>{
 const client=mount();fake.stats={lastWriteAgeMs:60000,lastConfirmedFixAgeMs:60000,error:''};act(()=>fake.callbacks!.onUpdate());
 expect(screen.getByTestId('state').textContent).toBe('tracking');
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});act(()=>document.dispatchEvent(new Event('visibilitychange')));
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});act(()=>document.dispatchEvent(new Event('visibilitychange')));
 expect(screen.getByTestId('state').textContent).toBe('tracking');
 fake.stats={lastWriteAgeMs:91000,lastConfirmedFixAgeMs:91000,error:''};act(()=>window.dispatchEvent(new Event('pageshow')));
 expect(screen.getByTestId('state').textContent).toBe('acquiring');client.clear();
});
