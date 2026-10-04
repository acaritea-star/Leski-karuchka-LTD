import { expect, it } from 'vitest';
import { getRequestMetrics, metricNow, recordRequestMetric } from './requestMetrics';
it('bounds local diagnostics and exposes only fixed operation names, outcomes and timings', () => {
  for (let i = 0; i < 300; i++) recordRequestMetric('gps.write', metricNow(), i % 2 ? 'ok' : 'error');
  const rows = getRequestMetrics();
  expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(200);
  expect(rows[0]).toMatchObject({ name: 'gps.write', errors: 100 });
  expect(Object.keys(rows[0]).sort()).toEqual(['avgMs', 'count', 'errors', 'maxMs', 'name', 'p95Ms']);
});
