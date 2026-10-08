export type RequestMetric = 'driver.read' | 'driver.online' | 'gps.read' | 'gps.write'
  | 'ride.accept' | 'ride.create' | 'ride.transition' | 'ride.cancel' | 'ride.reconcile'
  | 'tracking.read' | 'dashboard.read' | 'route.read';
type Outcome = 'ok' | 'error' | 'timeout' | 'aborted';
export type RequestSample = { name: RequestMetric; outcome: Outcome; ms: number };
const listeners = new Set<(sample: RequestSample) => void>();
export function observeRequestMetrics(listener: (sample: RequestSample) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
type Sample = RequestSample;
const samples: Sample[] = [];
const MAX_SAMPLES = 200;
export const metricNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

// Fixed diagnostic labels and timings only. The authenticated telemetry consumer
// batches these once a minute; recording itself never waits for a network request.
export function recordRequestMetric(name: RequestMetric, started: number, outcome: Outcome) {
  const ended = metricNow();
  samples.push({ name, outcome, ms: Math.max(0, ended - started) });
  if (samples.length > MAX_SAMPLES) samples.shift();
  for (const listener of listeners) { try { listener(samples[samples.length - 1]); } catch { /* Diagnostics cannot interrupt work. */ } }
  try {
    const label = `leski:${name}:${outcome}`;
    // Keep at most one standard browser Performance entry per label.
    performance.clearMeasures(label);
    performance.measure(label, { start: started, end: ended });
  } catch { /* Unsupported/restricted Performance API must never affect a ride. */ }
}
export function getRequestMetrics() {
  return [...new Set(samples.map(s => s.name))].map(name => {
    const rows = samples.filter(s => s.name === name), times = rows.map(s => s.ms).sort((a, b) => a - b);
    return { name, count: rows.length, errors: rows.filter(s => s.outcome !== 'ok').length,
      avgMs: rows.reduce((sum, s) => sum + s.ms, 0) / rows.length,
      p95Ms: times[Math.ceil(times.length * .95) - 1], maxMs: times[times.length - 1] };
  });
}
