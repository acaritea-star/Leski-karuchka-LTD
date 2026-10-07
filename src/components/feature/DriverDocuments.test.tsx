// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DriverDocuments from './DriverDocuments';
import { verificationKey, type VerificationReport } from '@/lib/driverVerification';
const fake = vi.hoisted(() => ({ report: null as unknown, rpc: vi.fn(), load: vi.fn(), prepare: vi.fn(), upload: vi.fn(), register: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: fake.rpc } }));
vi.mock('@/lib/driverDocuments', () => ({
  loadDocumentUpload: fake.load, prepareDocumentUpload: fake.prepare, uploadDriverDocument: fake.upload, registerDocumentUpload: fake.register,
  workflowError: (e: Error) => e.message,
}));
const report = (): VerificationReport => ({ driver_id: 'driver', is_verified: false, can_verify: false,
  blockers: [{ code: 'license', message: 'Липсва книжка.' }, { code: 'insurance', message: 'Липсва застраховка.' }], warnings: [],
  documents: { license: { state: 'missing', expires_at: null }, insurance: { state: 'missing', expires_at: null } },
});
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); fake.report = report(); fake.load.mockReturnValue(null);
  fake.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: fake.report, error: null }) }));
  fake.prepare.mockImplementation(async (_owner, type, expires) => ({ id: type + '-file', type, expires }));
  fake.upload.mockImplementation(async command => { const previous = fake.report as VerificationReport; fake.report = { ...previous, documents: { ...previous.documents, [command.type]: { state: 'pending', expires_at: command.expires } } }; });
  fake.register.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); client?.clear(); });
function mount(value = report()) {
  fake.report = value;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(verificationKey('driver'), value);
  render(<QueryClientProvider client={client}><DriverDocuments driverId="driver" userId="owner" /></QueryClientProvider>);
}
describe('the complete driver document UI', () => {
  it('shows both required documents immediately, without a type dropdown', () => {
    mount();
    expect(screen.getByRole('form', { name: 'Качване: Шофьорска книжка' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Качване: Застраховка' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('keeps insurance actionable when a licence upload is awaiting confirmation', () => {
    fake.load.mockImplementation((_owner, type) => type === 'license' ? { id: 'old', type, expires: '2099-01-01' } : null);
    mount();
    expect((within(screen.getByRole('region', { name: 'Шофьорска книжка' })).getByLabelText('Валиден до') as HTMLInputElement).disabled).toBe(true);
    expect((within(screen.getByRole('region', { name: 'Застраховка' })).getByLabelText('Валиден до') as HTMLInputElement).disabled).toBe(false);
  });
  it('an approved licence still displays the missing insurance and the expired vehicle reason', () => {
    const current = report(); current.documents.license = { state: 'approved', expires_at: '2099-01-01' };
    current.blockers = [{ code: 'insurance', message: 'Липсва застраховка.' }, { code: 'vehicle_inspection', message: 'Срокът на техническия преглед на автомобила е изтекъл.' }];
    mount(current);
    expect(within(screen.getByRole('region', { name: 'Шофьорска книжка' })).getByText('Одобрен')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Качване: Шофьорска книжка' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Качване: Застраховка' })).toBeTruthy();
    expect(screen.getByText('Срокът на техническия преглед на автомобила е изтекъл.')).toBeTruthy();
  });
  it('uploads insurance as insurance and refreshes its server status without requesting the licence again', async () => {
    const current = report(); current.documents.license = { state: 'approved', expires_at: '2099-01-01' }; mount(current);
    const region = within(screen.getByRole('region', { name: 'Застраховка' }));
    fireEvent.change(region.getByLabelText('Валиден до'), { target: { value: '2099-02-01' } });
    fireEvent.change(region.getByLabelText('Файл'), { target: { files: [new File(['insurance'], 'insurance.pdf', { type: 'application/pdf' })] } });
    fireEvent.submit(screen.getByRole('form', { name: 'Качване: Застраховка' }));
    await waitFor(() => expect(fake.upload).toHaveBeenCalledOnce());
    expect(fake.prepare).toHaveBeenCalledWith('owner', 'insurance', '2099-02-01', expect.any(File));
    await waitFor(() => expect(region.getByText('Очаква одобрение от фирмата')).toBeTruthy());
    expect(screen.queryByRole('form', { name: 'Качване: Шофьорска книжка' })).toBeNull();
  });
  it('keeps the upload unconfirmed on failure and prevents duplicate submissions', async () => {
    let fail!: (e: Error) => void;
    fake.upload.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
    mount(); const form = screen.getByRole('form', { name: 'Качване: Застраховка' }); const region = within(form);
    fireEvent.change(region.getByLabelText('Валиден до'), { target: { value: '2099-02-01' } });
    fireEvent.change(region.getByLabelText('Файл'), { target: { files: [new File(['x'], 'test.pdf', { type: 'application/pdf' })] } });
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(fake.upload).toHaveBeenCalledOnce());
    fail(new Error('Прекъсната връзка'));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Прекъсната връзка');
    expect(screen.queryByText('Документът е получен.', { exact: false })).toBeNull();
  });
});
