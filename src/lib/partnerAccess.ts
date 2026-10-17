import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { partnerEntryPath } from './authReturn';

export type PartnerKind = 'company' | 'driver';
export interface PartnerAccess {
  status: 'ready' | 'preparation' | 'denied'; destination?: string; role?: string;
  company_id?: string; company_name?: string; application_id?: string; reason?: string; message?: string;
}
const destinations = ['/admin/companies', '/admin/dashboard', '/company/setup', '/driver/home', '/driver/access', '/customer/home'];
export function parsePartnerAccess(data: unknown): PartnerAccess {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Достъпът не е потвърден. Опитай отново.');
  const value = data as PartnerAccess;
  if (!['ready', 'preparation', 'denied'].includes(value.status) || (value.status !== 'denied' && !destinations.includes(value.destination ?? ''))) throw new Error('Достъпът не е потвърден. Опитай отново.');
  if (value.status === 'preparation' && (!value.company_id || value.destination !== '/driver/access')) throw new Error('Фирмата не е потвърдена.');
  return value;
}
export async function resolvePartnerAccess(kind: PartnerKind | 'any', invitation?: string, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('resolve_partner_access', { p_kind: kind, p_invitation: invitation ?? undefined }).abortSignal(abort), 12_000, signal);
  if (error) throw error;
  return parsePartnerAccess(data);
}
export interface OpenDriverCompany {
  id: string; name: string; service_city: string | null;
  base_fare: number; min_fare: number; price_per_km: number; price_per_minute: number;
}
export async function loadOpenDriverCompanies(signal?: AbortSignal): Promise<OpenDriverCompany[]> {
  const { data, error } = await withRequestTimeout(abort => supabase.from('companies')
    .select('id,name,service_city,base_fare,min_fare,price_per_km,price_per_minute,currency')
    .eq('is_active', true).eq('accepts_driver_applications', true).not('setup_completed_at', 'is', null)
    .gt('price_per_km', 0).eq('currency', 'EUR').order('name').order('id').limit(50).abortSignal(abort), 12_000, signal);
  if (error) throw error;
  if (!Array.isArray(data) || data.some(c => !c.id || !c.name || c.currency !== 'EUR' ||
    ![c.base_fare, c.min_fare, c.price_per_km, c.price_per_minute].every(v => Number.isFinite(v) && v >= 0) || c.price_per_km <= 0)) {
    throw new Error('Фирмените тарифи не са потвърдени. Опитай отново.');
  }
  return data;
}
export async function openDriverAccess(companyId: string): Promise<PartnerAccess> {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('open_driver_access', { p_company: companyId }).abortSignal(signal));
  if (error) throw error;
  const access = parsePartnerAccess(data);
  if (access.status !== 'preparation' || access.company_id !== companyId || access.role !== 'CUSTOMER') throw new Error('Фирмата не е потвърдена.');
  return access;
}
export function invitationUrl(kind: PartnerKind, id: string): string {
  return 'https://leskikaruchka.com' + (kind === 'company' ? '/company/login' : '/driver/login') + '?invite=' + encodeURIComponent(id);
}
export function invitationLoginPath(kind: PartnerKind, invite?: string): string {
  const path = partnerEntryPath(kind, invite);
  return (kind === 'company' ? '/company/login' : '/driver/login') + (path.includes('?') ? path.slice(path.indexOf('?')) : '');
}
