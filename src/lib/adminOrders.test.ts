import { beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ calls: [] as unknown[][], response: { data: [] as unknown[], count: 0, error: null as unknown } }));
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const q = { select: (...args: unknown[]) => { api.calls.push(['select', ...args]); return q; },
    eq: (...args: unknown[]) => { api.calls.push(['eq', ...args]); return q; },
    in: (...args: unknown[]) => { api.calls.push(['in', ...args]); return q; },
    order: (...args: unknown[]) => { api.calls.push(['order', ...args]); return q; },
    range: (...args: unknown[]) => { api.calls.push(['range', ...args]); return q; },
    abortSignal: () => Promise.resolve(api.response) }; return q;
} } }));
import { loadAdminOrders } from './adminOrders';
beforeEach(() => { api.calls.length = 0; api.response = { data: [], count: 0, error: null }; });
it('filters active rides on the server before limiting, with a bounded stable page', async () => {
  await loadAdminOrders('company', 'active', 2);
  expect(api.calls).toContainEqual(['eq', 'company_id', 'company']);
  expect(api.calls).toContainEqual(['in', 'status', ['pending', 'accepted', 'arrived', 'in_progress']]);
  expect(api.calls).toContainEqual(['range', 100, 149]);
  expect(api.calls.findIndex(c => c[0] === 'in')).toBeLessThan(api.calls.findIndex(c => c[0] === 'range'));
  expect(api.calls).toContainEqual(['order', 'id', { ascending: false }]);
});
it('preserves a zero final price and resolves names without extra HTTP lookups', async () => {
  api.response = { count: 1, error: null, data: [{ id: 'ride', final_price: 0, estimated_price: 99,
    profiles: { first_name: 'Клиент', last_name: '' }, drivers: { profiles: { first_name: 'Шофьор', last_name: '' } } }] };
  expect((await loadAdminOrders('company', 'all')).rows[0]).toMatchObject({ final_price: 0, customer_name: 'Клиент', driver_name: 'Шофьор' });
  expect(api.calls.filter(c => c[0] === 'select')).toHaveLength(1);
});
it('fails visibly instead of interpreting an access error as an empty history', async () => {
  api.response.error = new Error('Denied');
  await expect(loadAdminOrders('company', 'all')).rejects.toThrow('Denied');
});
