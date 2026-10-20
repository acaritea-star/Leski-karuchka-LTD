import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Tables } from './database.types';
import { driverActiveRequestOptions } from './driverActiveRequest';
import { cacheDriverRequest } from './driverRequestCache';
import { queryKeys } from './queryKeys';
const fake = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
    limit: () => query, abortSignal: () => query, maybeSingle: () => fake.read() };
  return query;
} } }));
type Ride = Tables<'taxi_requests'>;
const row = (id: string, status: Ride['status']) => ({ id, driver_id: 'driver', status } as Ride);
let client: QueryClient;
beforeEach(() => { fake.read.mockReset(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => client.clear());
it.each(['completed', 'cancelled'] as const)('does not resurrect a %s ride when the active cache stayed empty during a slow read', async status => {
  client.setQueryData(queryKeys.driverActiveRequest('driver'), null);
  let finish!: (value: { data: Ride; error: null }) => void;
  fake.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = client.fetchQuery(driverActiveRequestOptions(client, 'driver'));
  expect(fake.read).toHaveBeenCalledOnce();
  cacheDriverRequest(client, 'driver', row('old', status));
  finish({ data: row('old', 'accepted'), error: null });
  expect(await pending).toBeNull();
  expect(client.getQueryData(queryKeys.driverActiveRequest('driver'))).toBeNull();
});
it('keeps a newer active ride when a slow read returns a different closed ride', async () => {
  client.setQueryData(queryKeys.driverActiveRequest('driver'), null);
  let finish!: (value: { data: Ride; error: null }) => void;
  fake.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = client.fetchQuery(driverActiveRequestOptions(client, 'driver'));
  cacheDriverRequest(client, 'driver', row('old', 'completed'));
  cacheDriverRequest(client, 'driver', row('new', 'accepted'));
  finish({ data: row('old', 'accepted'), error: null });
  expect(await pending).toMatchObject({ id: 'new', status: 'accepted' });
});
