import { metricNow, recordRequestMetric, type RequestMetric } from './requestMetrics';
/** Bound the entire SDK operation, including session locks and response bodies.
 * Uses ordinary AbortController for browsers without AbortSignal.timeout/any.
 * Cancellation cannot undo a write the server has already received.
 */
export function withRequestTimeout<T>(
  operation: (signal: AbortSignal) => PromiseLike<T> | T,
  milliseconds = 10_000,
  parent?: AbortSignal,
  metric?: RequestMetric,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const deadline = Date.now() + milliseconds;
    const started = metric ? metricNow() : 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = () => {
      const error = new Error('Връзката се забави. Опитай отново.');
      error.name = 'TimeoutError';
      finish(false, error);
    };
    const checkDeadline = () => { if (Date.now() >= deadline) timeout(); };
    const cancel = () => {
      const error = new Error('Заявката е прекратена.');
      error.name = 'AbortError';
      finish(false, error);
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', cancel);
      if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', checkDeadline);
      if (typeof window !== 'undefined') window.removeEventListener?.('pageshow', checkDeadline);
    };
    function finish(ok: boolean, value: unknown) {
      if (settled) return;
      settled = true;
      cleanup();
      if (metric) {
        const outcome = ok ? (value && typeof value === 'object' && 'error' in value && value.error ? 'error' : 'ok')
          : value instanceof Error && value.name === 'TimeoutError' ? 'timeout'
          : value instanceof Error && value.name === 'AbortError' ? 'aborted' : 'error';
        recordRequestMetric(metric, started, outcome);
      }
      if (!ok) { controller.abort(); reject(value); }
      else resolve(value as T);
    }
    if (parent?.aborted) { cancel(); return; }
    parent?.addEventListener('abort', cancel, { once: true });
    if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', checkDeadline);
    if (typeof window !== 'undefined') window.addEventListener?.('pageshow', checkDeadline);
    timer = setTimeout(timeout, milliseconds);
    try {
      Promise.resolve(operation(controller.signal)).then(value => {
        if (Date.now() >= deadline) timeout();
        else finish(true, value);
      }, error => finish(false, error));
    } catch (error) { finish(false, error); }
  });
}
