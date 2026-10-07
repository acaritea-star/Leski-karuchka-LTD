// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const mock=vi.hoisted(()=>({rpc:vi.fn(),read:vi.fn(),filter:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'user'}})}));
vi.mock('@/lib/supabase',()=>({supabase:{rpc:mock.rpc,from:()=>{const q={select:()=>q,eq:()=>q,in:(...args:unknown[])=>{mock.filter(...args);return q;},order:()=>q,limit:()=>q,abortSignal:()=>mock.read()};return q;}}}));
import PrivacyRequests from './PrivacyRequests';
beforeEach(()=>{vi.resetAllMocks();mock.read.mockResolvedValue({data:[],error:null});});afterEach(()=>cleanup());
function mount(admin=false){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><PrivacyRequests admin={admin}/></QueryClientProvider>);}
it('requires explicit confirmation for a deletion request and reports a received request, not completed erasure',async()=>{
 mock.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:'request-id',error:null})});mount();
 fireEvent.click(screen.getByRole('button',{name:'Поискай изтриване'}));expect(mock.rpc).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Потвърди искането'}));await screen.findByText(/Номер: request-id/);
 expect(mock.rpc).toHaveBeenCalledWith('request_personal_data',{p_kind:'deletion'});expect(screen.getByRole('status').textContent).toContain('обработено индивидуално');
});
it('keeps the administration queue scoped to open requests so resolved rows cannot hide old pending requests',async()=>{
 mount(true);await waitFor(()=>expect(mock.filter).toHaveBeenCalledWith('status',['pending','in_progress']));expect(mock.rpc).not.toHaveBeenCalled();
});
