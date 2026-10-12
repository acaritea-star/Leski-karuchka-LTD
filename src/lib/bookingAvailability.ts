import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export type BookingAvailability = { company_id: string; sampled_at: string; categories: Array<{ id: string; drivers: number; configured: boolean }> };
export function parseBookingAvailability(value: unknown, company: string): BookingAvailability {
  const fail = () => { throw new Error('Наличността не е потвърдена.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const v = value as BookingAvailability;
  if (v.company_id !== company || !Number.isFinite(Date.parse(v.sampled_at)) || !Array.isArray(v.categories)) return fail();
  const ids = new Set<string>();
  for (const item of v.categories) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || !Number.isSafeInteger(item.drivers) || item.drivers < 0 || typeof item.configured !== 'boolean') return fail();
    ids.add(item.id);
  }
  return v;
}
export function availabilityFresh(value: BookingAvailability | undefined, now = Date.now()) {
  const stamp = Date.parse(value?.sampled_at ?? '');
  return Number.isFinite(stamp) && stamp <= now + 30_000 && now - stamp < 30_000;
}
export async function loadBookingAvailability(company: string, lat: number, lng: number, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('booking_availability', { p_company: company, p_lat: lat, p_lng: lng }).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseBookingAvailability(data, company);
}
