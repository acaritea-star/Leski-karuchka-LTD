import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ write: vi.fn(), read: vi.fn(), insert: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const q = { insert: (payload: unknown) => { api.insert(payload); return q; }, select: () => q, eq: () => q,
    abortSignal: () => q, single: () => api.write(), maybeSingle: () => api.read() }; return q;
} } }));
import { companyPayload, createCompany } from './companyAdmin';
const form = { name: 'Такси Левски', phone: '', email: '', address: '', base_fare: '0', price_per_km: '1,10', price_per_minute: '0.28', dispatch_radius_km: '5' };
beforeEach(() => { vi.clearAllMocks(); api.write.mockResolvedValue({ data: { id: 'one' }, error: null }); api.read.mockResolvedValue({ data: null, error: null }); });
it('transliterates Bulgarian names, keeps explicit zero and accepts decimal comma', () => {
  expect(companyPayload(form, 'one')).toMatchObject({ slug: 'taksi-levski-one', base_fare: 0, price_per_km: 1.1 });
  expect(companyPayload(form, 'two').slug).not.toBe(companyPayload(form, 'one').slug);
});
it.each(['', '-1', 'Infinity', '1.1wrong', '2e3', '0.001'])('rejects invalid tariff %s without silently replacing it', value => {
  expect(() => companyPayload({ ...form, base_fare: value }, 'one')).toThrow();
});
it('rejects zero dispatch radius', () => expect(() => companyPayload({ ...form, dispatch_radius_km: '0' }, 'one')).toThrow());
it('confirms a lost response using the original company UUID', async () => {
  api.write.mockRejectedValue(new TypeError('Offline'));
  api.read.mockResolvedValue({ data: { id: 'one' }, error: null });
  await createCompany({ ...companyPayload(form, 'one'), id: 'one' });
  expect(api.insert).toHaveBeenCalledTimes(1);
});
it('does not claim success without a matching server record', async () => {
  api.write.mockResolvedValue({ data: null, error: null });
  api.read.mockResolvedValue({ data: { id: 'different' }, error: null });
  await expect(createCompany({ ...companyPayload(form, 'one'), id: 'one' })).rejects.toThrow();
});
