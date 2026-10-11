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
export function invitationUrl(kind: PartnerKind, id: string): string {
  return 'https://leskikaruchka.com' + (kind === 'company' ? '/company/login' : '/driver/login') + '?invite=' + encodeURIComponent(id);
}
export function invitationLoginPath(kind: PartnerKind, invite?: string): string {
  const path = partnerEntryPath(kind, invite);
  return (kind === 'company' ? '/company/login' : '/driver/login') + (path.includes('?') ? path.slice(path.indexOf('?')) : '');
}
