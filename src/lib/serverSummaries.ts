import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';

export interface DashboardSummary {
  stats: { totalDrivers: number; onlineDrivers: number; activeOrders: number; completedOrders: number; cancelledOrders: number; totalRevenue: number };
  chartData: { label: string; orders: number; revenue: number }[];
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Невалиден отговор за отчета.');
  return value as Record<string, unknown>;
};
function numeric(value: unknown, count = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || count && !Number.isSafeInteger(value)) {
    throw new Error('Невалидни стойности в отчета.');
  }
  return value;
}
export function parseDashboard(value: unknown): DashboardSummary {
  const result = record(value), s = record(result.stats);
  if (!Array.isArray(result.days) || result.days.length !== 7) throw new Error('Невалиден период на отчета.');
  return { stats: {
    totalDrivers: numeric(s.totalDrivers, true), onlineDrivers: numeric(s.onlineDrivers, true),
    activeOrders: numeric(s.activeOrders, true), completedOrders: numeric(s.completedOrders, true),
    cancelledOrders: numeric(s.cancelledOrders, true), totalRevenue: numeric(s.totalRevenue),
  }, chartData: result.days.map(value => {
    const day = record(value);
    if (typeof day.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.day)) throw new Error('Невалидна дата на отчета.');
    const date = new Date(`${day.day}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.day) throw new Error('Невалидна дата на отчета.');
    return { label: date.toLocaleDateString('bg-BG', { weekday: 'short', timeZone: 'Europe/Sofia' }),
      orders: numeric(day.orders, true), revenue: numeric(day.revenue) };
  }) };
}
export async function loadCompanyDashboard(companyId: string, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_dashboard', { p_company_id: companyId })
    .abortSignal(abort), 10_000, signal, 'dashboard.read');
  if (error) throw new Error(error.message);
  return parseDashboard(data);
}
export async function loadDriverDay(driverId: string, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('driver_day_summary', { p_driver_id: driverId })
    .abortSignal(abort), 10_000, signal, 'dashboard.read');
  if (error) throw new Error(error.message);
  const result = record(data);
  return { trips: numeric(result.trips, true), earnings: numeric(result.earnings) };
}
