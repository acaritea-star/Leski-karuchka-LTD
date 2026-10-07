// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useSignOut } from './useSignOut';
const api = vi.hoisted(() => ({ signOut: vi.fn(), navigate: vi.fn() }));
vi.mock('./useAuth', () => ({ useAuth: () => ({ signOut: api.signOut }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => api.navigate }));
beforeEach(() => { vi.clearAllMocks(); api.signOut.mockResolvedValue(undefined); });
afterEach(cleanup);
it('reports a failure instead of silently navigating, and permits a retry', async () => {
  api.signOut.mockRejectedValueOnce(new Error('Offline'));
  const hook = renderHook(() => useSignOut());
  await act(async () => { await hook.result.current.logout(); });
  expect(hook.result.current.error).toContain('не е потвърден');
  expect(api.navigate).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.logout(); });
  expect(api.navigate).toHaveBeenCalledWith('/');
  expect(hook.result.current.error).toBe('');
});
it('waits for offline confirmation and blocks duplicate clicks', async () => {
  let finish!: () => void;
  const before = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const hook = renderHook(() => useSignOut(before));
  let pending!: Promise<void>;
  act(() => { pending = hook.result.current.logout(); void hook.result.current.logout(); });
  expect(before).toHaveBeenCalledTimes(1);
  expect(api.signOut).not.toHaveBeenCalled();
  await act(async () => { finish(); await pending; });
  expect(api.signOut).toHaveBeenCalledTimes(1);
});
it('surfaces a failed driver offline operation before sign-out', async () => {
  const hook = renderHook(() => useSignOut(() => Promise.reject(new Error('Timeout'))));
  await act(async () => { await hook.result.current.logout(); });
  expect(hook.result.current.error).toBeTruthy();
  expect(api.signOut).not.toHaveBeenCalled();
});
