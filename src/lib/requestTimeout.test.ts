// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withRequestTimeout } from './requestTimeout';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('bounds a non-cooperative SDK promise and aborts the underlying request', async () => {
  let signal!: AbortSignal;
  let done!: (value: string) => void;
  const task = withRequestTimeout(abort => { signal = abort; return new Promise<string>(resolve => { done = resolve; }); }, 1000);
  const check = expect(task).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.advanceTimersByTimeAsync(1000); await check;
  expect(signal.aborted).toBe(true);
  done('late'); await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
it('clears timers after success and propagates synchronous or undefined failures', async () => {
  await expect(withRequestTimeout(() => Promise.resolve('ok'))).resolves.toBe('ok');
  expect(vi.getTimerCount()).toBe(0);
  await expect(withRequestTimeout(() => { throw new Error('broken'); })).rejects.toThrow('broken');
  await expect(withRequestTimeout(() => Promise.reject(undefined))).rejects.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels a parent signal even when the SDK never settles, and never starts an already cancelled call', async () => {
  const parent = new AbortController();
  const task = withRequestTimeout(() => new Promise(() => {}), 1000, parent.signal);
  const check = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  parent.abort(); await check;
  const operation = vi.fn();
  await expect(withRequestTimeout(operation, 1000, parent.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(operation).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
it('expires on pageshow when browser timers were frozen in the background', async () => {
  const task = withRequestTimeout(() => new Promise(() => {}), 1000);
  const check = expect(task).rejects.toMatchObject({ name: 'TimeoutError' });
  vi.setSystemTime(Date.now() + 10_000);
  window.dispatchEvent(new Event('pageshow')); await check;
  expect(vi.getTimerCount()).toBe(0);
});
it('works without the newer AbortSignal.timeout and AbortSignal.any APIs', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new Error('unsupported'); });
  const any = vi.spyOn(AbortSignal, 'any').mockImplementation(() => { throw new Error('unsupported'); });
  try {
    await expect(withRequestTimeout(() => Promise.resolve(7))).resolves.toBe(7);
    expect(timeout).not.toHaveBeenCalled(); expect(any).not.toHaveBeenCalled();
  } finally { timeout.mockRestore(); any.mockRestore(); }
});
