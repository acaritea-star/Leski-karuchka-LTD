import { withRequestTimeout } from './requestTimeout';

/** One bounded reconciliation read. Realtime carries normal updates; HTTP
 * recovers missed events and disconnected sockets without overlapping reads. */
export function createRealtimePoll<T>(read: (signal: AbortSignal) => PromiseLike<T>, apply: (value: T) => void,
  options: { fallbackMs?: number; healthyMs?: number; timeoutMs?: number; jitter?: () => number } = {}) {
  const fallbackMs = options.fallbackMs ?? 5000, healthyMs = options.healthyMs ?? 30_000;
  const jitter = options.jitter ?? Math.random;
  const controller = new AbortController();
  let active = true, pending = false, healthy = false, failures = 0, reconcile = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const schedule = (delay: number) => {
    clear();
    if (!active || document.visibilityState === 'hidden') return;
    timer = setTimeout(() => { void run(); }, delay + Math.floor(Math.max(0, Math.min(1, jitter())) * delay * .2));
  };
  async function run() {
    clear();
    if (!active || pending || document.visibilityState === 'hidden') return;
    pending = true;
    try {
      const result = await withRequestTimeout(read, options.timeoutMs ?? 10_000, controller.signal);
      if (!active) return;
      failures = 0; apply(result);
    } catch { if (active) failures++; }
    finally {
      pending = false;
      if (active) {
        if (reconcile) { reconcile = false; schedule(0); }
        else schedule(failures ? Math.min(60_000, fallbackMs * 2 ** Math.min(failures - 1, 4)) : healthy ? healthyMs : fallbackMs);
      }
    }
  }
  const resume = () => {
    if (document.visibilityState === 'hidden') { clear(); return; }
    if (pending) return;
    failures = 0; void run();
  };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('pageshow', resume);
  void run();
  return {
    setStatus(status: string) {
      if (!active) return;
      const next = status === 'SUBSCRIBED';
      if (next === healthy) return;
      healthy = next;
      // Reconcile the subscription gap once, even when the initial read is pending.
      if (pending) reconcile = true;
      else if (!failures) void run();
    },
    stop() {
      active = false; controller.abort(); clear();
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
    },
  };
}
