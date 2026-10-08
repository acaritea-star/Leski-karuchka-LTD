import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { isFreshTimestamp } from './driverLocation';

export const ADMIN_PAGE_SIZE = 50;
export interface CustomerSummary {
  id: string; first_name: string; last_name: string; phone: string | null;
  avatar_url: string | null; created_at: string; totalTrips: number; totalSpent: number;
}
export interface FleetDriver {
  id: string; first_name: string; last_name: string; latitude: number; longitude: number;
  updated_at: string; position_at: string; is_online: boolean;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Невалиден отговор от сървъра.');
  return value as Record<string, unknown>;
}
function number(value: unknown, count = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || count && !Number.isSafeInteger(value)) throw new Error('Невалидни стойности в отчета.');
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Невалиден отговор от сървъра.');
  return value;
}
function date(value: unknown): string {
  const result = text(value);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Невалидна дата от сървъра.');
  return result;
}
function page(value: unknown, limit: number) {
  const data = record(value), total = number(data.total, true);
  if (!Array.isArray(data.rows) || data.rows.length > limit || data.rows.length > total) throw new Error('Невалиден размер на отговора.');
  const rows = data.rows.map(record);
  if (new Set(rows.map(row => text(row.id))).size !== rows.length) throw new Error('Повторени записи в отговора.');
  return { rows, total };
}
export function parseCustomers(value: unknown): { rows: CustomerSummary[]; total: number } {
  const result = page(value, ADMIN_PAGE_SIZE);
  return { total: result.total, rows: result.rows.map(row => ({
    id: text(row.id), first_name: text(row.first_name ?? ''), last_name: text(row.last_name ?? ''),
    phone: row.phone === null ? null : text(row.phone), avatar_url: row.avatar_url === null ? null : text(row.avatar_url),
    created_at: date(row.created_at), totalTrips: number(row.totalTrips, true), totalSpent: number(row.totalSpent),
  })) };
}
export async function loadCustomers(companyId: string, search: string, page = 0, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_customers', {
    p_company: companyId, p_search: search, p_page: page,
  }).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseCustomers(data);
}
export function parseFleet(value: unknown): { rows: FleetDriver[]; total: number } {
  const result = page(value, 500);
  return { total: result.total, rows: result.rows.map(row => {
    if (typeof row.latitude !== 'number' || !Number.isFinite(row.latitude) || Math.abs(row.latitude) > 90 ||
      typeof row.longitude !== 'number' || !Number.isFinite(row.longitude) || Math.abs(row.longitude) > 180 || typeof row.is_online !== 'boolean') throw new Error('Невалидна позиция от сървъра.');
    return { id: text(row.id), first_name: text(row.first_name ?? ''), last_name: text(row.last_name ?? ''),
      latitude: row.latitude, longitude: row.longitude, is_online: row.is_online,
      updated_at: date(row.updated_at), position_at: date(row.position_at) };
  }) };
}
export async function loadFleet(companyId: string, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_fleet', { p_company: companyId })
    .abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseFleet(data);
}
export function fleetDriverOnline(driver: FleetDriver) {
  return driver.is_online && isFreshTimestamp(driver.updated_at) && isFreshTimestamp(driver.position_at);
}
