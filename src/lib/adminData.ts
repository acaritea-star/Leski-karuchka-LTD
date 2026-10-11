import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { isFreshTimestamp } from './driverLocation';
import type { Tables } from './database.types';

export const ADMIN_PAGE_SIZE = 50;
export interface CustomerSummary {
  id: string; first_name: string; last_name: string; phone: string | null;
  avatar_url: string | null; created_at: string; totalTrips: number; totalSpent: number;
}
export interface FleetDriver {
  id: string; first_name: string; last_name: string; latitude: number; longitude: number;
  updated_at: string; position_at: string | null; is_online: boolean;
}
export type AdminDriver = Pick<Tables<'drivers'>, 'id' | 'user_id' | 'company_id' | 'is_verified' | 'document_verification_required' | 'rating' | 'total_trips' | 'is_online'> & {
  first_name: string; last_name: string; online_now: boolean; gps_received_at: string | null; gps_position_at: string | null;
};
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
      updated_at: date(row.updated_at), position_at: row.position_at === null ? null : date(row.position_at) };
  }) };
}
export async function loadFleet(companyId: string, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_fleet', { p_company: companyId })
    .abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseFleet(data);
}
export function fleetDriverOnline(driver: FleetDriver, now = Date.now()) {
  return driver.is_online && isFreshTimestamp(driver.updated_at, now) && isFreshTimestamp(driver.position_at, now);
}
export function parseAdminDrivers(value: unknown, companyId: string): { rows: AdminDriver[]; total: number } {
  const result = page(value, ADMIN_PAGE_SIZE);
  return { total: result.total, rows: result.rows.map(row => {
    if (row.company_id !== companyId || ['is_online', 'online_now', 'is_verified', 'document_verification_required'].some(key => typeof row[key] !== 'boolean')) throw new Error('Непотвърден фирмен отговор. Обнови списъка.');
    const rating = number(row.rating);
    if (rating > 5) throw new Error('Невалиден рейтинг.');
    return { id: text(row.id), user_id: text(row.user_id), company_id: companyId,
      first_name: text(row.first_name), last_name: text(row.last_name), rating, total_trips: number(row.total_trips, true),
      is_online: row.is_online as boolean, online_now: row.online_now as boolean, is_verified: row.is_verified as boolean,
      document_verification_required: row.document_verification_required as boolean,
      gps_received_at: row.gps_received_at === null ? null : date(row.gps_received_at),
      gps_position_at: row.gps_position_at === null ? null : date(row.gps_position_at) };
  }) };
}
export async function loadAdminDrivers(companyId: string, search: string, page = 0, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_driver_page', {
    p_company: companyId, p_search: search, p_page: page,
  }).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseAdminDrivers(data, companyId);
}
export function adminDriverOnline(driver: AdminDriver, now = Date.now()) {
  return driver.online_now && driver.is_online && isFreshTimestamp(driver.gps_received_at, now) && isFreshTimestamp(driver.gps_position_at, now);
}
