export type RequestMetric = 'driver.read' | 'driver.online' | 'gps.read' | 'gps.write'
  | 'ride.accept' | 'ride.create' | 'ride.transition' | 'ride.cancel' | 'ride.reconcile'
  | 'tracking.read' | 'dashboard.read';
type Outcome = 'ok' | 'error' | 'timeout' | 'aborted';
type Sample = { name: RequestMetric; outcome: Outcome; ms: number };
const samples: Sample[] = [];
const MAX_SAMPLES = 200;
export const metricNow = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

// Session-only diagnostics: fixed labels and timings, no URLs, IDs, coordinates,
// tokens or error messages. No analytics request or database write is made.
export function recordRequestMetric(name: RequestMetric, started: number, outcome: Outcome) {
  const ended = metricNow();
  samples.push({ name, outcome, ms: Math.max(0, ended - started) });
  if (samples.length > MAX_SAMPLES) samples.shift();
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
