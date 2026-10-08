// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '@/i18n';
import Pricing from './page';
import Settings from '../settings/page';
const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), update: vi.fn(), companyId: 'company' }));
vi.mock('@/pages/admin/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: api.companyId }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'COMPANY_ADMIN' } }) }));
vi.mock('@/components/feature/PrivacyRequests', () => ({ default: () => null }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let mutation = false;
  const query = { select: () => query, eq: () => query, abortSignal: () => query,
    update: (data: unknown) => { mutation = true; api.update(data); return query; },
    single: () => mutation ? api.write() : api.read(),
  }; return query;
} } }));
beforeEach(() => {
  vi.clearAllMocks();
  api.companyId = 'company';
  api.read.mockResolvedValue({ data: { name: 'Company', base_fare: 2, price_per_km: 1, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR', document_checks_required: false }, error: null });
  api.write.mockResolvedValue({ data: { id: 'company' }, error: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it.each([Pricing, Settings])('blocks saves after a failed load and allows recovery', async Page => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  api.read.mockResolvedValueOnce({ data: null, error: new Error('Offline') });
  render(<Page />);
  const save = await screen.findByRole('button', { name: 'Запази' });
  expect((save as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(save); expect(api.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Опитай отново' }));
  expect((await screen.findByRole('button', { name: 'Запази' }) as HTMLButtonElement).disabled).toBe(false);
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
  api.read.mockResolvedValueOnce({ data: { name: 'New company', base_fare: 7, price_per_km: 1, price_per_minute: .2, dispatch_radius_km: 5, currency: 'EUR', document_checks_required: false }, error: null });
  view.rerender(<Page />);
  await screen.findByRole('button', { name: 'Запази' });
  await act(async () => finish({ data: { name: 'OLD COMPANY', base_fare: 99 }, error: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Запази' }));
  expect(api.update.mock.calls[0][0]).toMatchObject(Page === Pricing ? { base_fare: 7 } : { name: 'New company' });
});
