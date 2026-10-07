// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), lookup:vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id:'user' } }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({abortSignal:()=>({maybeSingle:mocks.lookup})})})})}) } }));
vi.mock('@/lib/accounting', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/accounting')>(), loadAccounting: mocks.report }));
import AccountingPanel from './AccountingPanel';
const report = { totals:{completed:2,cancelled:1,interrupted:0,booked:30,missing_amounts:0},finances:{income:0,expenses:0,handed_over:0,confirmed_handover:0},outcome_count:0,entry_count:0,outcomes:[],entries:[],drivers:[] };
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
function mount(company = false) {
 mocks.report.mockResolvedValue(report);
 const client = new QueryClient({ defaultOptions:{ queries:{retry:false},mutations:{retry:false} } });
 render(<QueryClientProvider client={client}><AccountingPanel {...company ? { companyId:'company' } : { driverId:'driver' }} /></QueryClientProvider>);
}
it('retries an uncertain write with the same operation ID instead of duplicating cash', async () => {
 mocks.lookup.mockResolvedValue({data:null,error:null});
 mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({error:{message:'network failure'}})}))
  .mockImplementationOnce((_name,command)=>({abortSignal:()=>Promise.resolve({data:command.p_id,error:null})}));
 mount();
 await screen.findByText('Моите сметки');
 fireEvent.change(screen.getByLabelText('Сума в евро'), {target:{value:'12,50'}});
 fireEvent.change(screen.getByLabelText('Описание'), {target:{value:'Cash received'}});
 fireEvent.click(screen.getByText('Добави запис'));
 await screen.findByRole('alert');
 fireEvent.click(screen.getByText('Добави запис'));
 await screen.findByText('Записът е запазен.');
 expect(mocks.rpc).toHaveBeenCalledTimes(2);
 expect(mocks.rpc.mock.calls[0][1].p_id).toBe(mocks.rpc.mock.calls[1][1].p_id);
 expect(mocks.rpc.mock.calls[1][1].p_amount).toBe(12.5);
});
it('does not present driver entry controls in a company report', async () => {
 mount(true);
 await screen.findByText('Курсове и откази');
 expect(screen.queryByText('Моите сметки')).toBeNull();
 expect(screen.getByText('30.00 €')).toBeTruthy();
});
it('changes the report month and reloads the first page', async () => {
 mount();
 await screen.findByText('Курсове и откази');
 fireEvent.change(screen.getByLabelText('Месец на отчета'),{target:{value:'2026-09'}});
 await waitFor(() => expect(mocks.report).toHaveBeenLastCalledWith('2026-09', {companyId:undefined,driverId:'driver'},0,expect.any(AbortSignal)));
});
