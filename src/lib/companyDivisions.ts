import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { monthBounds } from './accounting';
import { isInBulgaria } from './serviceArea';
import type { Tables } from './database.types';

export const divisionColumns = 'id,parent_company_id,name,service_city,service_latitude,service_longitude,service_radius_km,is_active,setup_completed_at,updated_at,base_fare,price_per_km,night_base_fare,night_price_per_km' as const;
export type CompanyDivision = Pick<Tables<'companies'>, 'id' | 'parent_company_id' | 'name' | 'service_city' | 'service_latitude' | 'service_longitude' | 'service_radius_km' | 'is_active' | 'setup_completed_at' | 'updated_at' | 'base_fare' | 'price_per_km' | 'night_base_fare' | 'night_price_per_km'>;
export interface DivisionDraft { name: string; service_city: string; service_latitude: number; service_longitude: number; service_radius_km: number }
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Отговорът за подразделението не е потвърден. Обнови и опитай отново.');
  return value as Record<string, unknown>;
};
export function parseDivision(value: unknown, parent: string): CompanyDivision {
  const row = object(value);
  if (typeof row.id !== 'string' || row.parent_company_id !== parent || typeof row.name !== 'string' || !row.name.trim()
    || typeof row.service_city !== 'string' || !row.service_city.trim() || typeof row.is_active !== 'boolean'
    || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at))
    || row.setup_completed_at !== null && (typeof row.setup_completed_at !== 'string' || !Number.isFinite(Date.parse(row.setup_completed_at)))
    || typeof row.service_latitude !== 'number' || typeof row.service_longitude !== 'number' || !isInBulgaria(row.service_latitude, row.service_longitude)
    || typeof row.service_radius_km !== 'number' || row.service_radius_km < .5 || row.service_radius_km > 30
    || ['base_fare','price_per_km'].some(key => typeof row[key] !== 'number' || !Number.isFinite(row[key]) || (row[key] as number) < 0)
    || ['night_base_fare','night_price_per_km'].some(key => row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || (row[key] as number) < 0))) {
    throw new Error('Подразделението или фирмените му данни не могат да бъдат проверени. Обнови списъка.');
  }
  return row as unknown as CompanyDivision;
}
export function validateDivisionDraft(draft: DivisionDraft): DivisionDraft {
  const next = { ...draft, name: draft.name.trim(), service_city: draft.service_city.trim().replace(/\s+/g, ' ') };
  if (next.name.length < 2 || next.name.length > 120 || next.service_city.length < 2 || next.service_city.length > 100
    || !Number.isFinite(next.service_latitude) || !Number.isFinite(next.service_longitude) || !isInBulgaria(next.service_latitude, next.service_longitude)
    || !Number.isFinite(next.service_radius_km) || next.service_radius_km < .5 || next.service_radius_km > 30
    || Number(next.service_radius_km.toFixed(2)) !== next.service_radius_km) {
    throw new Error('Попълни име, град и избери център на зона в България с радиус 0,5–30 км.');
  }
  return next;
}
export async function loadCompanyDivisions(parent: string, signal?: AbortSignal): Promise<CompanyDivision[]> {
  const { data, error } = await withRequestTimeout(abort => supabase.from('companies').select(divisionColumns)
    .eq('parent_company_id', parent).order('service_city').order('id').limit(101).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  if (!Array.isArray(data) || data.length > 100 || new Set(data.map(row => row.id)).size !== data.length) throw new Error('Списъкът с подразделения не е потвърден.');
  return data.map(row => parseDivision(row, parent));
}
export async function saveCompanyDivision(parent: string, id: string, draft: DivisionDraft, previous?: CompanyDivision): Promise<CompanyDivision> {
  const payload = validateDivisionDraft(draft);
  if (!previous) {
    const { data, error } = await withRequestTimeout(signal => supabase.rpc('create_company_division', { p_id: id, p_parent: parent, p_data: { ...payload } }).abortSignal(signal), 12_000);
    if (error) throw error;
    const result = parseDivision(data, parent);
    if (result.id !== id) throw new Error('Създаването не е потвърдено. Обнови списъка преди нов опит.');
    return result;
  }
  if (previous.id !== id || previous.parent_company_id !== parent) throw new Error('Подразделението не е от тази фирма.');
  const { data, error } = await withRequestTimeout(signal => supabase.from('companies').update(payload)
    .eq('id', id).eq('parent_company_id', parent).eq('updated_at', previous.updated_at).select(divisionColumns).abortSignal(signal).single(), 12_000);
  if (error || !data) throw new Error(error?.code === 'PGRST116' ? 'Данните или достъпът са променени. Обнови списъка преди нов запис.' : 'Записът не е потвърден. Обнови списъка преди нов опит.');
  return parseDivision(data, parent);
}
export async function setDivisionActive(division: CompanyDivision, active: boolean): Promise<CompanyDivision> {
  if (!division.parent_company_id || !division.setup_completed_at) throw new Error('Първо завърши настройката и въведи реалните разрешения и тарифи.');
  const { data, error } = await withRequestTimeout(signal => supabase.from('companies').update({ is_active: active })
    .eq('id', division.id).eq('parent_company_id', division.parent_company_id!).eq('updated_at', division.updated_at)
    .select(divisionColumns).abortSignal(signal).single(), 12_000);
  if (error || !data) throw new Error('Промяната не е потвърдена. Обнови списъка и провери текущия статус.');
  const result = parseDivision(data, division.parent_company_id);
  if (result.is_active !== active) throw new Error('Статусът не е потвърден. Обнови списъка.');
  return result;
}

export const divisionMetricKeys = ['online_income','completed','cancelled','income','expenses','handed_over','cash_income','card_income','unknown_income','cash_closing'] as const;
export type DivisionMetrics = Record<typeof divisionMetricKeys[number], number>;
export interface DivisionReport {
  parent_company_id: string; currency: 'EUR'; generated_at: string;
  companies: { id: string; name: string; service_city: string | null; parent_company_id: string | null; is_active: boolean; summary: DivisionMetrics }[];
  total: DivisionMetrics;
}
function metrics(value: unknown): DivisionMetrics {
  const row = object(value);
  if(row.online_income===undefined)row.online_income=0;
  for (const key of divisionMetricKeys) {
    const v = row[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isSafeInteger(Math.round(v * 100))
      || (key === 'completed' || key === 'cancelled' ? !Number.isSafeInteger(v) || v < 0 : Number(v.toFixed(2)) !== v)) throw new Error('Сумите в общия отчет не могат да бъдат проверени.');
  }
  if (Math.round((row.cash_income as number) * 100) + Math.round((row.card_income as number) * 100)
    + Math.round((row.unknown_income as number) * 100) !== Math.round((row.income as number) * 100)) throw new Error('Разбивката на плащанията в отчета не съвпада.');
  return row as DivisionMetrics;
}
export function parseDivisionReport(value: unknown, parent: string, month: string): DivisionReport {
  const report = object(value), period = object(report.period), bounds = monthBounds(month);
  if (report.report_version !== 1 || report.parent_company_id !== parent || report.currency !== 'EUR' || period.from !== bounds.from || period.until !== bounds.until || period.timezone !== 'Europe/Sofia'
    || typeof report.generated_at !== 'string' || !Number.isFinite(Date.parse(report.generated_at))
    || !Array.isArray(report.companies) || report.companies.length < 1 || report.companies.length > 101) throw new Error('Периодът или обхватът на общия отчет не е потвърден.');
  const companies = report.companies.map(value => {
    const row = object(value);
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.is_active !== 'boolean'
      || row.service_city !== null && typeof row.service_city !== 'string'
      || (row.id === parent ? row.parent_company_id !== null : row.parent_company_id !== parent)) throw new Error('Общият отчет съдържа непотвърдена фирма.');
    return { id: row.id, name: row.name, service_city: row.service_city as string | null, parent_company_id: row.parent_company_id as string | null, is_active: row.is_active, summary: metrics(row.summary) };
  });
  const total = metrics(report.total);
  if (new Set(companies.map(c => c.id)).size !== companies.length || !companies.some(c => c.id === parent)) throw new Error('Подразделенията в отчета не са потвърдени.');
  for (const key of divisionMetricKeys) {
    const sum = companies.reduce((n, c) => n + BigInt(Math.round(c.summary[key] * 100)), 0n);
    if (sum !== BigInt(Math.round(total[key] * 100))) throw new Error('Общата сума не съвпада с отчетите по подразделения.');
  }
  return { parent_company_id: parent, currency: 'EUR', generated_at: report.generated_at, companies, total };
}
export async function loadDivisionReport(parent: string, month: string, signal?: AbortSignal): Promise<DivisionReport> {
  const { from, until } = monthBounds(month);
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('company_group_report', { p_parent: parent, p_from: from, p_until: until }).abortSignal(abort), 15_000, signal);
  if (error) throw error;
  return parseDivisionReport(data, parent, month);
}
