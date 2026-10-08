// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRealtimePoll } from './realtimePoll';
let polls: Array<ReturnType<typeof createRealtimePoll>>;
beforeEach(() => {
  vi.useFakeTimers(); polls = [];
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => { polls.forEach(p => p.stop()); vi.useRealTimers(); });
const flush = async () => { await vi.advanceTimersByTimeAsync(0); };
it('does not start or repeat reads offline, and reconciles once when internet returns', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  const read = vi.fn().mockResolvedValue(1);
  const poll = createRealtimePoll(read, vi.fn(), { jitter: () => 0 }); polls.push(poll);
  poll.setStatus('SUBSCRIBED');
  await vi.advanceTimersByTimeAsync(60_000); expect(read).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  window.dispatchEvent(new Event('online')); await flush(); expect(read).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  window.dispatchEvent(new Event('offline'));
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledOnce();
});
it('uses slow reconciliation on a healthy socket and fast reads immediately after disconnect', async () => {
  const read = vi.fn().mockResolvedValue(1), apply = vi.fn();
  const poll = createRealtimePoll(read, apply, { jitter: () => 0 }); polls.push(poll);
  await flush(); poll.setStatus('SUBSCRIBED'); await flush();
  const initial = read.mock.calls.length;
  await vi.advanceTimersByTimeAsync(29_999); expect(read).toHaveBeenCalledTimes(initial);
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(initial + 1);
  poll.setStatus('CHANNEL_ERROR'); await flush();
  expect(read).toHaveBeenCalledTimes(initial + 2);
  await vi.advanceTimersByTimeAsync(5000); expect(read).toHaveBeenCalledTimes(initial + 3);
});
it('never overlaps reads, bounds a hung SDK call, and ignores its late response', async () => {
  let finish!: (v: number) => void;
  const read = vi.fn().mockReturnValueOnce(new Promise<number>(resolve => { finish = resolve; })).mockResolvedValue(2), apply = vi.fn();
  const poll = createRealtimePoll(read, apply, { jitter: () => 0 }); polls.push(poll);
  for (let n = 0; n < 50; n++) window.dispatchEvent(new Event('pageshow'));
  await vi.advanceTimersByTimeAsync(9999); expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(5001); expect(read).toHaveBeenCalledTimes(2); expect(apply).toHaveBeenCalledWith(2);
  finish(1); await flush(); expect(apply).toHaveBeenCalledOnce();
});
it('pauses hidden pages, recovers on return, and cancels timers and pending work on stop', async () => {
  const read = vi.fn().mockResolvedValue(1), apply = vi.fn();
  const poll = createRealtimePoll(read, apply, { jitter: () => 0 }); polls.push(poll); await flush();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange')); await flush(); expect(read).toHaveBeenCalledTimes(2);
  read.mockImplementation(() => new Promise(() => {}));
  window.dispatchEvent(new Event('online')); const signal = read.mock.calls.at(-1)?.[0]; poll.stop();
  expect(signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000); expect(read).toHaveBeenCalledTimes(3); expect(apply).toHaveBeenCalledTimes(2);
});
it('backs off failures and repeated socket errors do not cause a request storm', async () => {
  const read = vi.fn().mockRejectedValue(new Error('Offline'));
  const poll = createRealtimePoll(read, vi.fn(), { jitter: () => 0 }); polls.push(poll); await flush();
  for (let n = 0; n < 50; n++) { poll.setStatus('CHANNEL_ERROR'); poll.setStatus('SUBSCRIBED'); }
  await vi.advanceTimersByTimeAsync(4999); expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999); expect(read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(3);
});
it('spreads periodic requests across clients while keeping the recovery interval bounded', async () => {
  const read = vi.fn().mockResolvedValue(1);
  const poll = createRealtimePoll(read, vi.fn(), { jitter: () => 1 }); polls.push(poll); await flush();
  await vi.advanceTimersByTimeAsync(5999); expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); expect(read).toHaveBeenCalledTimes(2);
});
it('keeps one hundred healthy tracking readers bounded and stops every reader on cleanup', async () => {
  const reads = Array.from({ length: 100 }, () => vi.fn().mockResolvedValue(1));
  for (let i = 0; i < reads.length; i++) {
    const poll = createRealtimePoll(reads[i], vi.fn(), { jitter: () => i / 100 }); polls.push(poll);
    poll.setStatus('SUBSCRIBED');
  }
  await flush();
  await vi.advanceTimersByTimeAsync(120_000);
  // Two initial reconciliations plus at most four periodic reads per view,
  // rather than a five-second HTTP loop while the socket is healthy.
  expect(reads.every(read => read.mock.calls.length <= 6)).toBe(true);
  const before = reads.map(read => read.mock.calls.length);
  polls.forEach(poll => poll.stop());
  await vi.advanceTimersByTimeAsync(120_000);
  expect(reads.map(read => read.mock.calls.length)).toEqual(before);
});
