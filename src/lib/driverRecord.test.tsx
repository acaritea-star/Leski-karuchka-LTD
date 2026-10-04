// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { driverRecordOptions } from './driverRecord';
import { queryKeys } from './queryKeys';
const fake = vi.hoisted(() => ({ select: vi.fn(), reads: vi.fn(), owner: '' }));
vi.mock('./supabase', () => ({ supabase: { from: () => {
  const q = { select: (fields: string) => { fake.select(fields); return q; },
    eq: (_field: string, owner: string) => { fake.owner = owner; return q; }, abortSignal: () => q,
    maybeSingle: async () => { fake.reads(); return { data: { id: `driver-${fake.owner}`, user_id: fake.owner,
      company_id: 'company', is_online: true, is_verified: true, status: 'available' }, error: null }; } };
  return q;
} } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('keeps the full online/GPS record when an ID-only history observer shares the cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({
    history: useQuery({ ...driverRecordOptions('user'), select: row => row?.id }),
    live: useQuery(driverRecordOptions('user')),
  }), { wrapper });
  await waitFor(() => expect(result.current.history.data).toBe('driver-user'));
  expect(fake.reads).toHaveBeenCalledOnce();
  expect(fake.select).toHaveBeenCalledWith('*');
  expect(result.current.live.data).toMatchObject({ is_online: true, company_id: 'company' });
  expect(client.getQueryData(queryKeys.driverRecord('user'))).toMatchObject({ status: 'available', is_verified: true });
  client.clear();
});
it('never reuses another account driver record', async () => {
  const client = new QueryClient();
  await client.fetchQuery(driverRecordOptions('first'));
  await client.fetchQuery(driverRecordOptions('second'));
  expect(fake.reads).toHaveBeenCalledTimes(2);
  expect(client.getQueryData(queryKeys.driverRecord('second'))).toMatchObject({ user_id: 'second', id: 'driver-second' });
  client.clear();
});
