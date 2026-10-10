// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ companyId: 'company', read: vi.fn(), rpc: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ save: 'Запази', loading: 'Зареждане', cancel: 'Отказ' }[key] ?? key) }) }));
vi.mock('@/pages/admin/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: api.companyId }) }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  from: (table: string) => {
    const filters: Record<string, string> = {};
    const query = { select: () => query, order: () => query, abortSignal: () => query,
      eq: (key: string, value: string) => { filters[key] = value; return query; }, in: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => api.read(table, filters).then(resolve, reject),
    }; return query;
  },
  rpc: (...args: unknown[]) => ({ abortSignal: () => api.rpc(...args) }),
} }));
import Vehicles from './page';
const standard = { id: 'standard', company_id: 'company', name: 'Стандарт', is_active: true, capacity: 4, multiplier: 1 };
const disabled = { ...standard, id: 'disabled', name: 'Спряна категория', is_active: false };
const driver = { id: 'driver', user_id: 'driver-user', vehicle_id: null };
let categories = [standard, disabled];
let cars: Record<string, unknown>[] = [];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = () => <QueryClientProvider client={client}><Vehicles /></QueryClientProvider>;
  return { ...render(content()), client, content };
}
async function openForm() { const button = await screen.findByRole('button', { name: 'Добави автомобил' }); await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button); }
function fillCar() {
  fireEvent.change(screen.getByLabelText('Марка'), { target: { value: ' Мерцедес ' } });
  fireEvent.change(screen.getByLabelText('Модел'), { target: { value: ' CLK ' } });
  fireEvent.change(screen.getByLabelText('Рег. номер'), { target: { value: ' A2255KX ' } });
}
beforeEach(() => {
  vi.clearAllMocks(); api.companyId = 'company'; categories = [standard, disabled]; cars = [];
  api.read.mockImplementation(async (table: string) => ({ data: table === 'vehicle_types' ? categories : table === 'vehicles' ? cars : table === 'drivers' ? [driver] : [{ id: 'driver-user', first_name: 'Владимир', last_name: 'Атанасов' }], error: null }));
  api.rpc.mockResolvedValue({ data: 'car', error: null });
});
afterEach(() => cleanup());
it('selects the only active category and sends one correctly scoped vehicle assignment', async () => {
  let finish!: (result: unknown) => void;
  api.rpc.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  mount(); await openForm(); fillCar();
  expect((screen.getByLabelText('Тип') as HTMLSelectElement).value).toBe('standard');
  expect(screen.queryByRole('option', { name: 'Спряна категория' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Шофьор'), { target: { value: 'driver' } });
  const save = screen.getByRole('button', { name: 'Запази' }); fireEvent.click(save); fireEvent.click(save);
  await waitFor(() => expect(api.rpc).toHaveBeenCalledTimes(1));
  expect(api.rpc.mock.calls[0]).toEqual(['save_driver_vehicle', expect.objectContaining({ p_company: 'company', p_driver: 'driver', p_details: expect.objectContaining({ make: 'Мерцедес', model: 'CLK', registration_number: 'A2255KX', vehicle_type_id: 'standard' }) })]);
  await act(async () => { finish({ data: 'car', error: null }); });
});
it('reports a missing category without blaming a filled registration number', async () => {
  categories = [standard, { ...standard, id: 'comfort', name: 'Комфорт' }];
  mount(); await openForm(); fillCar(); fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  expect(screen.getByRole('alert').textContent).toBe('Изберете активна категория автомобил.');
  expect(api.rpc).not.toHaveBeenCalled();
});
it('reports the registration field separately', async () => {
  mount(); await openForm(); fillCar();
  fireEvent.change(screen.getByLabelText('Рег. номер'), { target: { value: ' ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  expect(screen.getByRole('alert').textContent).toBe('Въведете регистрационен номер.');
  expect(api.rpc).not.toHaveBeenCalled();
});
it('explains an empty active category list before opening an unsaveable form', async () => {
  categories = [disabled]; mount();
  await screen.findByText(/Фирмата няма активна категория автомобил/);
  expect((screen.getByRole('button', { name: 'Добави автомобил' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.rpc).not.toHaveBeenCalled();
});
it('blocks writes on a category read error and recovers with a retry', async () => {
  const read = api.read.getMockImplementation()!;
  api.read.mockImplementation((table: string, filters: unknown) => table === 'vehicle_types' ? Promise.resolve({ data: null, error: new Error('Offline categories') }) : read(table, filters));
  mount(); await screen.findByText('Offline categories');
  expect((screen.getByRole('button', { name: 'Добави автомобил' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/Фирмата няма активна категория автомобил/)).toBeNull();
  api.read.mockImplementation(read); fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  await openForm(); expect((screen.getByLabelText('Тип') as HTMLSelectElement).value).toBe('standard');
});
it('closes the old form when company changes and cannot carry a vehicle into another firm', async () => {
  const view = mount(); await openForm(); fillCar();
  api.companyId = 'other-company'; categories = [{ ...standard, id: 'other-standard', company_id: 'other-company' }];
  view.rerender(view.content()); expect(screen.queryByLabelText('Рег. номер')).toBeNull();
  await openForm(); expect((screen.getByLabelText('Рег. номер') as HTMLInputElement).value).toBe('');
  fillCar(); fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  await waitFor(() => expect(api.rpc).toHaveBeenCalledWith('save_driver_vehicle', expect.objectContaining({ p_company: 'other-company', p_details: expect.objectContaining({ vehicle_type_id: 'other-standard' }) })));
});
it('blocks a category that was disabled while the vehicle form was open', async () => {
  const view = mount(); await openForm(); fillCar();
  categories = [disabled]; await act(async () => { await view.client.invalidateQueries(); });
  await waitFor(() => expect((screen.getByRole('button', { name: 'Запази' }) as HTMLButtonElement).disabled).toBe(true));
  expect(screen.getByRole('option', { name: /Категорията е неактивна/ })).toBeTruthy();
  expect(api.rpc).not.toHaveBeenCalled();
});
