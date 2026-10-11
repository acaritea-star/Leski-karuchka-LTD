// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import Pricing from './page';
import Settings from '../settings/page';
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), update: vi.fn(), eq: vi.fn(), companyId: 'company' }));
vi.mock('@/pages/admin/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: api.companyId }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'COMPANY_ADMIN' } }) }));
vi.mock('@/components/feature/PrivacyRequests', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let mutation = false;
  const query = { select: () => query, eq: (name: string, value: string) => { api.eq(name, value); return query; }, abortSignal: () => query,
    update: (data: unknown) => { mutation = true; api.update(data); return query; },
    single: () => mutation ? api.write() : api.read(),
  }; return query;
} } }));
beforeEach(() => {
  vi.clearAllMocks();
  api.companyId = 'company';
  api.read.mockResolvedValue({ data: { id: 'company', updated_at: '2026-10-11T09:00:00Z', name: 'Company', base_fare: 2, min_fare: 0, price_per_km: 1, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR', document_checks_required: false }, error: null });
  api.write.mockResolvedValue({ data: { id: 'company', updated_at: '2026-10-11T09:01:00Z', base_fare: 2, min_fare: 0, price_per_km: 1, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR' }, error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([Pricing, Settings])('blocks saves after a failed load and allows recovery', async Page => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.read.mockResolvedValueOnce({ data: null, error: new Error('Offline') });
  render(<Page />);
  await screen.findByRole('button', { name: 'Опитай отново' });
  const save = screen.queryByRole('button', { name: 'Запази' });
  if (Page === Pricing) { expect(save).toBeNull(); expect(screen.queryAllByRole('spinbutton')).toHaveLength(0); }
  else { expect((save as HTMLButtonElement).disabled).toBe(true); fireEvent.click(save!); }
  expect(api.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  expect((await screen.findByRole('button', { name: 'Запази' }) as HTMLButtonElement).disabled).toBe(false);
});
it('shows the tariffs returned by the server after saving', async () => {
  api.write.mockResolvedValue({ data: { id: 'company', updated_at: '2026-10-11T09:01:00Z', base_fare: 4.15, min_fare: 3, price_per_km: 1.23, price_per_minute: .17, dispatch_radius_km: 6, currency: 'EUR' }, error: null });
  render(<Pricing />); fireEvent.click(await screen.findByRole('button', { name: 'Запази' }));
  await screen.findByText('Настройките са запазени успешно.');
  expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('4.15');
});
it('does not report a zero-row pricing update as saved', async () => {
  api.write.mockResolvedValue({ data: null, error: new Error('No authorized company') });
  render(<Pricing />);
  fireEvent.click(await screen.findByRole('button', { name: 'Запази' }));
  await screen.findByText('No authorized company');
  expect(screen.queryByText('Настройките са запазени успешно.')).toBeNull();
});
it('does not send two pricing writes for rapid repeated clicks', async () => {
  api.write.mockReturnValue(new Promise(() => {}));
  render(<Pricing />);
  const button = await screen.findByRole('button', { name: 'Запази' });
  fireEvent.click(button); fireEvent.click(button);
  expect(api.update).toHaveBeenCalledTimes(1);
});
it.each([Pricing, Settings])('ignores an old company response after the operator changes company', async Page => {
  let finish!: (value: unknown) => void;
  api.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const view = render(<Page />);
  api.companyId = 'other-company';
  api.read.mockResolvedValueOnce({ data: { id: 'other-company', updated_at: '2026-10-11T09:00:00Z', name: 'New company', base_fare: 7, price_per_km: 1, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR', document_checks_required: false }, error: null });
  view.rerender(<Page />);
  await screen.findByRole('button', { name: 'Запази' });
  await act(async () => finish({ data: { name: 'OLD COMPANY', base_fare: 99 }, error: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  expect(api.update.mock.calls[0][0]).toMatchObject(Page === Pricing ? { base_fare: 7 } : { name: 'New company' });
});
it('does not silently replace a newer tariff version from another panel', async () => {
  api.write.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
  render(<Pricing />);
  const button = await screen.findByRole('button', { name: 'Запази' });
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '1.5' } });
  fireEvent.click(button);
  await screen.findByRole('button', { name: 'Обнови тарифите' });
  expect(api.eq).toHaveBeenCalledWith('updated_at', '2026-10-11T09:00:00Z');
  expect(screen.queryByText('Настройките са запазени успешно.')).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('1.5');
  fireEvent.click(button); expect(api.update).toHaveBeenCalledTimes(1);
  api.read.mockResolvedValue({ data: { id: 'company', updated_at: '2026-10-11T09:02:00Z', base_fare: 3, min_fare: 0, price_per_km: 1.7, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR' }, error: null });
  fireEvent.click(screen.getByRole('button', { name: 'Обнови тарифите' }));
  await screen.findByRole('button', { name: 'Запази' });
  expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('1.7');
});
it('confirms the exact new tariff version after a lost write reply without replay', async () => {
  const initial = await api.read();
  api.read.mockResolvedValueOnce(initial).mockResolvedValue({ data: { ...initial.data, price_per_km: 1.5, updated_at: '2026-10-11T09:02:00Z' }, error: null });
  api.write.mockRejectedValue(new TypeError('Failed to fetch'));
  render(<Pricing />);
  await screen.findByRole('button', { name: 'Запази' });
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  await screen.findByText('Настройките са запазени успешно.');
  expect(api.update).toHaveBeenCalledTimes(1);
});
it('keeps a lost write unconfirmed when the stored values differ', async () => {
  api.write.mockRejectedValue(new TypeError('Failed to fetch'));
  render(<Pricing />);
  await screen.findByRole('button', { name: 'Запази' });
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '9' } });
  fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  await screen.findByRole('button', { name: 'Обнови тарифите' });
  expect(api.update).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Настройките са запазени успешно.')).toBeNull();
});
it('does not turn an empty price into a submitted zero', async () => {
  render(<Pricing />); const button = await screen.findByRole('button', { name: 'Запази' });
  fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '' } });
  expect((screen.getAllByRole('spinbutton')[1] as HTMLInputElement).value).toBe('');
  fireEvent.click(button);
  await screen.findByText('Въведи неотрицателни цени и радиус по-голям от нула.');
  expect(api.update).not.toHaveBeenCalled();
});
