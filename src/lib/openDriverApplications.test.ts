import { afterEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: mocks }));
import { loadOpenDriverCompanies, openDriverAccess } from './partnerAccess';
const id = '11111111-1111-4111-8111-111111111111';
const company = { id, name: 'Фирма', service_city: 'Левски', base_fare: 2, min_fare: 4, price_per_km: 1.2, price_per_minute: 0.2, currency: 'EUR' };
afterEach(() => vi.resetAllMocks());
function listing(data: unknown, error: unknown = null) {
  const chain = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), gt: vi.fn(), order: vi.fn(), limit: vi.fn(), abortSignal: vi.fn().mockResolvedValue({ data, error }) };
  for (const key of ['select', 'eq', 'not', 'gt', 'order', 'limit'] as const) chain[key].mockReturnValue(chain);
  mocks.from.mockReturnValue(chain); return chain;
}
it('lists only active, configured firms that explicitly accept applications, with a bounded read', async () => {
  const query = listing([company]);
  expect(await loadOpenDriverCompanies()).toEqual([company]);
  expect(query.eq).toHaveBeenCalledWith('accepts_driver_applications', true);
  expect(query.eq).toHaveBeenCalledWith('is_active', true);
  expect(query.not).toHaveBeenCalledWith('setup_completed_at', 'is', null);
  expect(query.limit).toHaveBeenCalledWith(50);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([null, [{ ...company, price_per_km: 0 }], [{ ...company, base_fare: NaN }], [{ ...company, currency: 'BGN' }]])('refuses invalid firm/rate data instead of showing invented prices', async data => {
  listing(data); await expect(loadOpenDriverCompanies()).rejects.toThrow('тарифи');
});
it('does not turn a failed read into an empty list', async () => {
  listing(null, new Error('offline')); await expect(loadOpenDriverCompanies()).rejects.toThrow('offline');
});
it('rechecks the selected firm on the server and grants preparation only', async () => {
  const access = { status: 'preparation', destination: '/driver/access', role: 'CUSTOMER', company_id: id };
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data: access, error: null }) });
  expect(await openDriverAccess(id)).toEqual(access);
  expect(mocks.rpc).toHaveBeenCalledWith('open_driver_access', { p_company: id });
});
it.each([{ status: 'ready', destination: '/driver/home', role: 'DRIVER', company_id: id },
  { status: 'preparation', destination: '/driver/access', role: 'CUSTOMER', company_id: 'foreign' }])('refuses a changed company or prematurely privileged response', async data => {
  mocks.rpc.mockReturnValue({ abortSignal: () => Promise.resolve({ data, error: null }) });
  await expect(openDriverAccess(id)).rejects.toThrow('Фирмата не е потвърдена');
});
