import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Tables } from './database.types';
const fake = vi.hoisted(() => ({ rpc: vi.fn(), write: vi.fn(), read: vi.fn(), update: vi.fn(), filters: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {
  rpc: (...args: unknown[]) => ({ abortSignal: () => fake.rpc(...args) }),
  from: () => { const q = { select: () => q, eq: (...args: unknown[]) => { fake.filters(...args); return q; },
    update: (value: unknown) => { fake.update(value); return q; }, abortSignal: () => q,
    single: () => fake.write(), maybeSingle: () => fake.read() }; return q; },
} }));
import { acceptTaxiRequest, cancelTaxiRequest, createTaxiRequest, transitionTaxiRequest } from './rideOperations';
const row = (status: Tables<'taxi_requests'>['status'], driver = 'driver') => ({ id: 'ride', driver_id: driver,
  customer_id: 'customer', status, final_price: 17, updated_at: new Date().toISOString() } as Tables<'taxi_requests'>);
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); fake.read.mockResolvedValue({ data: null, error: null }); });
afterEach(() => { vi.useRealTimers(); });
it('confirms acceptance after a lost acknowledgement without sending another accept', async () => {
  fake.rpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fake.read.mockResolvedValueOnce({ data: row('accepted'), error: null });
  await expect(acceptTaxiRequest('ride', 'driver')).resolves.toMatchObject({ driver_id: 'driver', status: 'accepted' });
  expect(fake.rpc).toHaveBeenCalledOnce(); expect(fake.read).toHaveBeenCalledOnce();
});
it('never confirms a competing driver acceptance or replays the mutation', async () => {
  fake.rpc.mockRejectedValueOnce(new TypeError('Network response lost'));
  fake.read.mockResolvedValueOnce({ data: row('accepted', 'other'), error: null });
  await expect(acceptTaxiRequest('ride', 'driver')).rejects.toThrow('Network response lost');
  expect(fake.rpc).toHaveBeenCalledOnce();
});
it('reconciles the SDK resolved transport error with an empty error code', async () => {
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
  fake.read.mockResolvedValueOnce({ data: row('accepted'), error: null });
  await expect(acceptTaxiRequest('ride', 'driver')).resolves.toMatchObject({ status: 'accepted' });
  expect(fake.rpc).toHaveBeenCalledOnce(); expect(fake.read).toHaveBeenCalledOnce();
});
it('returns an advanced authoritative phase after a guarded transition misses its old status', async () => {
  fake.write.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: 'No matching old status' } });
  fake.read.mockResolvedValueOnce({ data: row('in_progress'), error: null });
  await expect(transitionTaxiRequest(row('accepted'), 'arrived')).resolves.toMatchObject({ status: 'in_progress', final_price: 17 });
  expect(fake.write).toHaveBeenCalledOnce(); expect(fake.filters).toHaveBeenCalledWith('status', 'accepted');
});
it('bounds a hung cancellation, confirms a committed cancellation, and ignores the late response', async () => {
  let finish!: (reply: unknown) => void;
  fake.write.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  fake.read.mockResolvedValueOnce({ data: row('cancelled'), error: null });
  const promise = cancelTaxiRequest('ride', 'accepted');
  await vi.advanceTimersByTimeAsync(15_000);
  const confirmed = await promise; expect(confirmed.status).toBe('cancelled');
  finish({ data: row('accepted'), error: null }); await vi.advanceTimersByTimeAsync(0);
  expect(confirmed.status).toBe('cancelled'); expect(fake.write).toHaveBeenCalledOnce();
});
it('does not add recovery reads or retries for explicit authorization/business failures', async () => {
  fake.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Not permitted' } });
  await expect(acceptTaxiRequest('ride', 'driver')).rejects.toThrow('Not permitted');
  expect(fake.read).not.toHaveBeenCalled(); expect(fake.rpc).toHaveBeenCalledOnce();
});
it('recovers the original booking ID after response loss and sends the stable idempotency key once', async () => {
  fake.rpc.mockRejectedValueOnce(new TypeError('Disconnected'));
  fake.read.mockResolvedValueOnce({ data: row('pending'), error: null });
  await expect(createTaxiRequest('quote', 'ride', 'customer')).resolves.toMatchObject({ id: 'ride' });
  expect(fake.rpc).toHaveBeenCalledWith('create_taxi_request', { p_quote_id: 'quote', p_request_id: 'ride', p_payment_method: 'cash' });
  expect(fake.rpc).toHaveBeenCalledOnce();
});
it('accepts the server-linked existing ride when a quote was already used', async () => {
  fake.rpc.mockResolvedValueOnce({ data: row('accepted'), error: null });
  await expect(createTaxiRequest('quote', 'new-browser-key', 'customer')).resolves.toMatchObject({ id: 'ride' });
  expect(fake.read).not.toHaveBeenCalled(); expect(fake.rpc).toHaveBeenCalledOnce();
});
it('does not confirm another customer or another request during booking recovery', async () => {
  fake.rpc.mockRejectedValueOnce(new TypeError('Disconnected'));
  fake.read.mockResolvedValueOnce({ data: { ...row('pending'), customer_id: 'other' }, error: null });
  await expect(createTaxiRequest('quote', 'ride', 'customer')).rejects.toThrow('Disconnected');
  fake.rpc.mockRejectedValueOnce(new TypeError('Disconnected'));
  fake.read.mockResolvedValueOnce({ data: { ...row('pending'), id: 'another' }, error: null });
  await expect(createTaxiRequest('quote', 'ride', 'customer')).rejects.toThrow('Disconnected');
  expect(fake.rpc).toHaveBeenCalledTimes(2);
});
