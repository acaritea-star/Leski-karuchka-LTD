// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { isOpenRequest, useFreshRequests } from './useFreshRequests';
const request = (ms: number) => ({ status: 'pending' as const, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + ms).toISOString() });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('removes expired offers without polling the database', async () => {
  vi.useFakeTimers();
  const rows = [request(1000), request(2000)];
  const hook = renderHook(() => useFreshRequests(rows));
  expect(hook.result.current).toHaveLength(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
  expect(hook.result.current).toEqual([rows[1]]);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(hook.result.current).toHaveLength(0);
});
it('rechecks a suspended page on return even if its timer never fired', () => {
  vi.useFakeTimers();
  const rows = [request(1000)];
  const hook = renderHook(() => useFreshRequests(rows));
  vi.setSystemTime(Date.now() + 2000);
  act(() => { window.dispatchEvent(new Event('pageshow')); });
  expect(hook.result.current).toHaveLength(0);
});
it('handles legacy expiry and invalid timestamps conservatively', () => {
  const row = { ...request(100), expires_at: null };
  expect(isOpenRequest(row, Date.parse(row.created_at) + 119999)).toBe(true);
  expect(isOpenRequest(row, Date.parse(row.created_at) + 120000)).toBe(false);
  expect(isOpenRequest({ ...row, expires_at: 'invalid' })).toBe(false);
  expect(isOpenRequest({ ...row, status: 'cancelled' })).toBe(false);
});
