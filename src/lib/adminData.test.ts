import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { parseCustomers, parseFleet, fleetDriverOnline } from './adminData';
const customer = { id: 'customer', first_name: 'Иван', last_name: '', phone: null, avatar_url: null, created_at: '2026-10-08T01:00:00Z', totalTrips: 1201, totalSpent: 1215 };
const driver = { id: 'driver', first_name: 'Иван', last_name: '', latitude: 43.2, longitude: 25.6, is_online: true, updated_at: new Date().toISOString(), position_at: new Date().toISOString() };
it('accepts exact customer totals above the REST row cap', () => {
  expect(parseCustomers({ rows: [customer], total: 61 })).toEqual({ rows: [customer], total: 61 });
});
it.each([null, {}, { rows: [], total: NaN }, { rows: [customer, customer], total: 2 }, { rows: [{ ...customer, totalSpent: 'unknown' }], total: 1 }, { rows: [customer], total: 0 }])('rejects malformed customer reports', value => expect(() => parseCustomers(value)).toThrow());
it('returns a device timestamp along with server receipt', () => expect(parseFleet({ rows: [driver], total: 1 }).rows[0]).toEqual(driver));
it('does not present an old GPS fix with a recent heartbeat as online', () => {
  expect(fleetDriverOnline(driver)).toBe(true);
  expect(fleetDriverOnline({ ...driver, position_at: new Date(Date.now() - 60_000).toISOString() })).toBe(false);
  expect(fleetDriverOnline({ ...driver, is_online: false })).toBe(false);
});
it.each([{ ...driver, latitude: NaN }, { ...driver, longitude: 181 }, { ...driver, position_at: 'wrong' }, { ...driver, is_online: 'yes' }])('rejects invalid fleet data', row => expect(() => parseFleet({ rows: [row], total: 1 })).toThrow());
