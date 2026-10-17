// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), lookup:vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id:'user' } }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({abortSignal:()=>({maybeSingle:mocks.lookup})})})})}) } }));
vi.mock('@/lib/accounting', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/accounting')>(), loadAccounting: mocks.report }));
import AccountingPanel from './AccountingPanel';
import { accountingFixture, addUnpaidRide, entryFixture } from '../../../tests/fixtures/accounting';
const report = addUnpaidRide(accountingFixture());
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });
function mount(company = false, data = report) {
 mocks.report.mockResolvedValue(data);
 const client = new QueryClient({ defaultOptions:{ queries:{retry:false},mutations:{retry:false} } });
 render(<QueryClientProvider client={client}><AccountingPanel {...company ? { companyId:'company' } : { driverId:'driver' }} /></QueryClientProvider>);
}
it('retries an uncertain write with the same operation ID instead of duplicating cash', async () => {
 mocks.lookup.mockResolvedValue({data:null,error:null});
 mocks.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({error:{message:'network failure'}})}))
  .mockImplementationOnce((_name,command)=>({abortSignal:()=>Promise.resolve({data:command.p_id,error:null})}));
 mount();
 await screen.findByText('История на сметките');
 fireEvent.click(screen.getByRole('button', { name: '+ Получени' }));
 fireEvent.change(screen.getByLabelText('Сума в евро'), {target:{value:'12,50'}});
 fireEvent.change(screen.getByLabelText('Описание'), {target:{value:'Cash received'}});
 fireEvent.click(screen.getByText('Добави запис'));
 await screen.findByRole('alert');
 fireEvent.click(screen.getByText('Повтори същия запис'));
 await screen.findByText('Записът е запазен.');
 expect(mocks.rpc).toHaveBeenCalledTimes(2);
 expect(mocks.rpc.mock.calls[0][1].p_id).toBe(mocks.rpc.mock.calls[1][1].p_id);
 expect(mocks.rpc.mock.calls[1][1].p_amount).toBe(12.5);
});
it('does not present driver entry controls in a company report', async () => {
 mount(true);
 await screen.findByText('История на сметките');
 expect(screen.queryByRole('button', { name: '+ Получени' })).toBeNull();
 expect(screen.getAllByText('12.34 €').length).toBeGreaterThan(0);
});
it('changes the report month and reloads the first page', async () => {
 mount();
 await screen.findByText('История на сметките');
 fireEvent.change(screen.getByLabelText('Месец на отчета'),{target:{value:'2026-09'}});
 await waitFor(() => expect(mocks.report).toHaveBeenLastCalledWith('2026-09', {companyId:undefined,driverId:'driver'},0,expect.any(AbortSignal)));
});

it('prefills a ride without claiming that the quoted amount has already been paid', async () => {
 Element.prototype.scrollIntoView = vi.fn();
 mount(); await screen.findByText('История на сметките');
 fireEvent.click(screen.getByRole('button', { name: 'Курсове' }));
 fireEvent.click(screen.getByText('Отчети плащането'));
 expect((screen.getByLabelText('Сума в евро') as HTMLInputElement).value).toBe('12.34');
 expect((screen.getByLabelText('Връзка с курс от показаната страница') as HTMLSelectElement).value).toBe(report.outcomes[0].request_id);
 expect(mocks.rpc).not.toHaveBeenCalled();
});
it('requires evidence for an administrator correction of confirmed money', async () => {
 const data = accountingFixture(); const entry = { ...entryFixture(), confirmed: true }; data.entries = [entry]; data.entry_count = 1;
 mocks.rpc.mockImplementation((_name, command) => ({ abortSignal: () => Promise.resolve({ data: command.p_id, error: null }) }));
 mount(true, data); await screen.findByText('Коригирай сверения запис');
 fireEvent.click(screen.getByText('Коригирай сверения запис'));
 fireEvent.change(screen.getByLabelText('Основание'), { target: { value: 'Грешен документ' } });
 fireEvent.change(screen.getByLabelText('Източник'), { target: { value: 'receipt' } });
 const reference = screen.getByLabelText('Номер / референция') as HTMLInputElement;
 expect(reference.required).toBe(true);
 fireEvent.change(reference, { target: { value: 'R-2' } });
 fireEvent.click(screen.getByRole('button', { name: /^Потвърди$/ }));
 await screen.findByText('Записът е запазен.');
 expect(mocks.rpc).toHaveBeenCalledWith('record_driver_money_method', expect.objectContaining({ p_kind: 'reversal', p_reference_id: entry.id, p_source: 'receipt', p_evidence_ref: 'R-2', p_actor: 'user' }));
});
it('does not replace an unavailable report with zero financial totals', async () => {
 mount(); await screen.findByText('История на сметките');
 mocks.report.mockRejectedValue(new Error('offline'));
 fireEvent.change(screen.getByLabelText('Месец на отчета'), { target: { value: '2026-09' } });
 await screen.findByRole('alert');
 expect(screen.queryByText('Остатък по въведените сметки')).toBeNull();
 expect((screen.getByRole('button', { name: 'Изтегли CSV' }) as HTMLButtonElement).disabled).toBe(true);
});
it('clears the financial draft after checking an uncertain operation that already succeeded', async () => {
 mocks.lookup.mockResolvedValue({ data: null, error: null });
 mocks.rpc.mockImplementation((_name, command) => ({ abortSignal: () => Promise.resolve({ error: { message: 'network failure' }, data: command.p_id }) }));
 mount(); await screen.findByText('История на сметките');
 fireEvent.click(screen.getByRole('button', { name: '+ Получени' }));
 fireEvent.change(screen.getByLabelText('Сума в евро'), { target: { value: '12,50' } });
 fireEvent.change(screen.getByLabelText('Описание'), { target: { value: 'Гориво' } });
 fireEvent.click(screen.getByText('Добави запис')); await screen.findByRole('alert');
 const id = mocks.rpc.mock.calls[0][1].p_id;
 mocks.lookup.mockResolvedValue({ data: { id, actor_id: 'user' }, error: null });
 fireEvent.click(screen.getByText('Провери записа')); await screen.findByText('Записът е потвърден.');
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button', { name: '+ Получени' }));
 expect((screen.getByLabelText('Сума в евро') as HTMLInputElement).value).toBe('');
 expect((screen.getByLabelText('Описание') as HTMLInputElement).value).toBe('');
});
it('keeps a company report read-only when scoped to a driver', async () => {
 mocks.report.mockResolvedValue(report);
 const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 render(<QueryClientProvider client={client}><AccountingPanel companyId="company" driverId="driver" /></QueryClientProvider>);
 await screen.findByText('История на сметките');
 expect(screen.queryByRole('button', { name: '+ Получени' })).toBeNull();
 expect(screen.queryByRole('button', { name: '− Разход' })).toBeNull();
 expect(mocks.report).toHaveBeenCalledWith(expect.any(String), { companyId: 'company', driverId: 'driver' }, 0, expect.any(AbortSignal));
});

it('starts card reconciliation with a payment record and a required transaction reference', async () => {
 const data=accountingFixture();data.entries=[{...entryFixture(),payment_method:'card'}];data.entry_count=1;
 mount(true,data);await screen.findByText('Свери приход');fireEvent.click(screen.getByText('Свери приход'));
 expect((screen.getByLabelText('Източник') as HTMLSelectElement).value).toBe('bank_record');
 expect((screen.getByLabelText('Номер / референция') as HTMLInputElement).required).toBe(true);
 expect(screen.queryByRole('option', { name: 'Преброени пари' })).toBeNull();
 expect(screen.queryByRole('option', { name: 'Касов разчет' })).toBeNull();
 expect(mocks.rpc).not.toHaveBeenCalled();
});
