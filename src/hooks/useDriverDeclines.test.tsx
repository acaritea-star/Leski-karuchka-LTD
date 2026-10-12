// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useDriverDeclines } from './useDriverDeclines';

const api = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  let payload: unknown, options: unknown, single = false;
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query, abortSignal: () => query,
    eq: (name: string, value: unknown) => { filters[name] = value; return query; },
    in: (name: string, value: unknown) => { filters[name] = value; return query; },
    limit: (value: number) => { filters.limit = value; return query; },
    maybeSingle: () => { single = true; return query; },
    upsert: (value: unknown, settings: unknown) => { payload = value; options = settings; return query; },
    then: (resolve: (value: unknown) => unknown, reject: (cause: unknown) => unknown) =>
      Promise.resolve(payload ? api.write(payload, options) : api.read(filters, single)).then(resolve, reject),
  };
  return query;
} } }));

const clients: QueryClient[] = [];
function mount(ids: string[] = ['a', 'b']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, ...renderHook(({ ids }) => useDriverDeclines('driver', ids), { wrapper, initialProps: { ids } }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.read.mockResolvedValue({ data: [], error: null });
  api.write.mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); });

it('loads only displayed requests and keeps one cache for reordered IDs', async () => {
  const hook = mount(['b', 'a', 'a']);
  await waitFor(() => expect(hook.result.current.declinesReady).toBe(true));
  expect(api.read).toHaveBeenCalledWith({ driver_id: 'driver', request_id: ['a', 'b'], limit: 50 }, false);
  hook.rerender({ ids: ['a', 'b'] });
  expect(api.read).toHaveBeenCalledTimes(1);
});
it('does not fetch historical refusals when no offers are displayed', () => {
  const hook = mount([]);
  expect(hook.result.current.declinesReady).toBe(true);
  expect(api.read).not.toHaveBeenCalled();
});
it('restores an offer after a failed first write with no previous cache', async () => {
  api.read.mockReturnValue(new Promise(() => {}));
  api.write.mockResolvedValue({ error: { code: '42501', message: 'Denied' } });
  const hook = mount();
  act(() => hook.result.current.decline('a'));
  await waitFor(() => expect(hook.result.current.declineError).toMatchObject({ code: '42501' }));
  expect(hook.result.current.declinedIds.has('a')).toBe(false);
});
it('rolls back only the failed refusal while another write is pending', async () => {
  let failA!: (value: unknown) => void, finishB!: (value: unknown) => void;
  api.write.mockImplementation((row: { request_id: string }) => new Promise(resolve => {
    if (row.request_id === 'a') failA = resolve; else finishB = resolve;
  }));
  const hook = mount();
  await waitFor(() => expect(hook.result.current.declinesReady).toBe(true));
  act(() => { hook.result.current.decline('a'); hook.result.current.decline('b'); });
  await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
  await act(async () => failA({ error: { code: '42501', message: 'Denied' } }));
  await waitFor(() => expect(hook.result.current.declinedIds.has('a')).toBe(false));
  expect(hook.result.current.declinedIds.has('b')).toBe(true);
  expect(api.read).toHaveBeenCalledTimes(1);
  api.read.mockResolvedValue({ data: [{ request_id: 'b' }], error: null });
  await act(async () => finishB({ error: null }));
  await waitFor(() => expect(hook.result.current.isDeclining).toBe(false));
  expect(hook.result.current.declinedIds.has('b')).toBe(true);
});
it('uses duplicate-safe INSERT without requiring UPDATE permission', async () => {
  api.read.mockResolvedValue({ data: [{ request_id: 'a' }], error: null });
  const hook = mount();
  await waitFor(() => expect(hook.result.current.declinedIds.has('a')).toBe(true));
  act(() => hook.result.current.decline('a'));
  await waitFor(() => expect(api.write).toHaveBeenCalledWith({ request_id: 'a', driver_id: 'driver' },
    { onConflict: 'request_id,driver_id', ignoreDuplicates: true }));
});
it('confirms a committed refusal after a lost reply without a second write', async () => {
  api.write.mockRejectedValue(new TypeError('Failed to fetch'));
  api.read.mockImplementation((_filters, single) => Promise.resolve({ data: single ? { request_id: 'a' } : [{ request_id: 'a' }], error: null }));
  const hook = mount();
  await waitFor(() => expect(hook.result.current.declinesReady).toBe(true));
  act(() => hook.result.current.decline('a'));
  await waitFor(() => expect(api.write).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(hook.result.current.isDeclining).toBe(false));
  expect(hook.result.current.declineError).toBeNull();
  expect(hook.result.current.declinedIds.has('a')).toBe(true);
  expect(api.read).toHaveBeenCalledWith({ driver_id: 'driver', request_id: 'a' }, true);
});
it('does not write a request outside the current offer list', async () => {
  const hook = mount();
  act(() => hook.result.current.decline('foreign'));
  await waitFor(() => expect(hook.result.current.declineError).toBeInstanceOf(Error));
  expect(api.write).not.toHaveBeenCalled();
});
