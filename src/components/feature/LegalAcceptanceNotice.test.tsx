// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const mock=vi.hoisted(()=>({read:vi.fn(),accept:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'user'}})}));
vi.mock('@/lib/legalAcceptance',()=>({acceptCurrentLegal:mock.accept}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>{const q={select:()=>q,eq:()=>q,abortSignal:()=>q,maybeSingle:mock.read};return q;}}}));
import LegalAcceptanceNotice from './LegalAcceptanceNotice';
beforeEach(()=>{vi.resetAllMocks();});afterEach(()=>cleanup());
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(<QueryClientProvider client={client}><MemoryRouter><LegalAcceptanceNotice/></MemoryRouter></QueryClientProvider>);}
it('waits for an explicit continuation before recording an existing account acceptance',async()=>{
 mock.read.mockResolvedValue({data:null,error:null});mock.accept.mockResolvedValue('record');mount();
 await screen.findByRole('button',{name:'Продължи'});expect(mock.accept).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Продължи'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Продължи'})).toBeNull());expect(mock.accept).toHaveBeenCalledWith('continue');
});
it('does not repeatedly ask a user who has the current server record',async()=>{
 mock.read.mockResolvedValue({data:{id:'existing'},error:null});mount();await waitFor(()=>expect(mock.read).toHaveBeenCalled());
 expect(screen.queryByRole('button',{name:'Продължи'})).toBeNull();expect(mock.accept).not.toHaveBeenCalled();
});
