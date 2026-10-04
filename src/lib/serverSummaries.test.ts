import { expect, it } from 'vitest';
import { parseDashboard } from './serverSummaries';
const fixture = () => ({ stats: { totalDrivers: 1200, onlineDrivers: 50, activeOrders: 2,
  completedOrders: 1203, cancelledOrders: 1, totalRevenue: 1209 },
  days: Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-${19+i}`, orders: i === 6 ? 1201 : 0, revenue: i === 6 ? 1202 : 0 })) });
it('renders server counts and Sofia dates without depending on the browser timezone', () => {
  const report = parseDashboard(fixture());
  expect(report.stats.completedOrders).toBe(1203);
  expect(report.chartData[6]).toMatchObject({ label: 'нд', orders: 1201, revenue: 1202 });
});
it('rejects incomplete or non-finite aggregates instead of displaying fabricated zero totals', () => {
  expect(() => parseDashboard({ ...fixture(), stats: {} })).toThrow();
  expect(() => parseDashboard({ ...fixture(), stats: { ...fixture().stats, totalRevenue: Infinity } })).toThrow();
  expect(() => parseDashboard({ ...fixture(), days: [{ day: '2026-02-30', orders: 1, revenue: 1 }, ...fixture().days.slice(1)] })).toThrow();
});
