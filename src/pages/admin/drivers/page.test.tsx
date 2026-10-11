// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ company: 'a', load: vi.fn(), filters: [] as [string, unknown][], verified: true }));
vi.mock('@/pages/admin/components/AdminLayout', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/pages/admin/components/AdminCompanyContext', () => ({ useAdminCompany: () => ({ companyId: api.company, companyName: api.company, companies: [{ id: 'a' }, { id: 'b' }], loading: false }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'SUPER_ADMIN' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/feature/DriverVerificationStatus', () => ({ default: ({ driverId }: { driverId: string }) => <p>Проверка на {driverId}</p> }));
vi.mock('./DriverApplications', () => ({ default: ({ companyId }: { companyId: string }) => <p>Покани за {companyId}</p> }));
vi.mock('@/lib/adminData', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/adminData')>(), loadAdminDrivers: api.load }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const builder = { select: () => builder, update: () => { api.verified = false; return builder; },
    eq: (key: string, value: unknown) => { api.filters.push([key, value]); return builder; }, order: () => builder,
    abortSignal: () => builder, single: async () => ({ data: { id: 'a-0' }, error: null }),
    then: (fn: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(fn) };
  return builder;
} } }));
import AdminDrivers from './page';
beforeEach(() => {
  api.company = 'a'; api.verified = true; api.filters = []; vi.clearAllMocks();
  api.load.mockImplementation(async (company: string, search: string, page: number) => ({ total: search ? 1 : company === 'a' ? 61 : 1,
    rows: Array.from({ length: search || company === 'b' ? 1 : page === 0 ? 50 : 11 }, (_, i) => ({
      id: company + '-' + (page * 50 + i), company_id: company, user_id: 'u-' + i,
      first_name: 'Водач ' + company + (page * 50 + i), last_name: '', is_verified: api.verified,
      document_verification_required: false, rating: 5, total_trips: 0, is_online: true, online_now: true,
      gps_received_at: new Date().toISOString(), gps_position_at: new Date().toISOString(),
    })) }));
});
afterEach(cleanup);
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element = () => <QueryClientProvider client={client}><AdminDrivers /></QueryClientProvider>;
  return { ...render(element()), element, client };
}
it('loads driver pages and debounces search while keeping every request scoped', async () => {
  setup(); await screen.findByText('Водач a0');
  expect(screen.getAllByRole('button', { name: 'Детайли' })).toHaveLength(50);
  fireEvent.click(screen.getByRole('button', { name: 'Следващи шофьори' }));
  await screen.findByText('Водач a50'); expect(screen.getAllByRole('button', { name: 'Детайли' })).toHaveLength(11);
  fireEvent.change(screen.getByRole('textbox', { name: 'Търси шофьори' }), { target: { value: 'В' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Търси шофьори' }), { target: { value: 'Водач' } });
  await waitFor(() => expect(api.load).toHaveBeenCalledWith('a', 'Водач', 0, expect.any(AbortSignal)));
  expect(api.load.mock.calls.every(call => call[0] === 'a' && call[1] !== 'В')).toBe(true);
});
it('closes driver details and invitation state when the selected firm changes', async () => {
  const view = setup(); await screen.findByText('Водач a0');
  fireEvent.click(screen.getAllByRole('button', { name: 'Детайли' })[0]);
  await screen.findByText('Проверка на a-0');
  api.company = 'b'; view.rerender(view.element());
  await screen.findByText('Водач b0');
  expect(screen.queryByText('Проверка на a-0')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Добави шофьор' }));
  await screen.findByText('Покани за b');
  fireEvent.click(screen.getByRole('button', { name: 'Затвори поканите' }));
  expect(screen.queryByText('Покани за b')).toBeNull();
});
it('verification buttons write the selected driver and firm and refresh the persisted result', async () => {
  setup(); await screen.findByText('Водач a0');
  fireEvent.click(screen.getAllByRole('button', { name: 'Отнеми верификация' })[0]);
  await screen.findAllByRole('button', { name: 'Верифицирай' });
  expect(api.filters).toContainEqual(['id', 'a-0']); expect(api.filters).toContainEqual(['company_id', 'a']);
  expect(api.filters).toContainEqual(['is_verified', true]);
});
it('returns to an existing page when other changes shrink the firm list', async () => {
  const view = setup(); await screen.findByText('Водач a0');
  fireEvent.click(screen.getByRole('button', { name: 'Следващи шофьори' })); await screen.findByText('Водач a50');
  const first = api.load.mock.results[0].value;
  const row = (await first).rows[0];
  api.load.mockImplementation(async (_company: string, _search: string, page: number) => ({ total: 1, rows: page === 0 ? [row] : [] }));
  await view.client.invalidateQueries({ queryKey: ['drivers', 'company', 'a'] });
  await screen.findByText('Водач a0'); expect(screen.queryByText('Водач a50')).toBeNull();
});
