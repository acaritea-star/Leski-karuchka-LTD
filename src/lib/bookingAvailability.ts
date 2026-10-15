import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export type BookingAvailability = { company_id: string; sampled_at: string; categories: Array<{ id: string; drivers: number; configured: boolean }> };
export type AvailableCarrier = { company_id: string; vehicle_type_id: string; service_class: string };
export type MarketplaceAvailability = BookingAvailability & { carriers: AvailableCarrier[] };
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
export function parseMarketplaceAvailability(value: unknown): MarketplaceAvailability {
  const base = parseBookingAvailability(value, 'marketplace');
  const carriers = (value as MarketplaceAvailability).carriers;
  if (!Array.isArray(carriers)) throw new Error('Наличността на фирмите не е потвърдена.');
  const pairs = new Set<string>();
  for (const carrier of carriers) {
    if (!carrier || typeof carrier.company_id !== 'string' || !carrier.company_id.trim()
      || typeof carrier.vehicle_type_id !== 'string' || !carrier.vehicle_type_id.trim()
      || !['standard', 'comfort', 'van'].includes(carrier.service_class)
      || !base.categories.some(c => c.id === carrier.service_class && c.configured && c.drivers > 0)
      || pairs.has(JSON.stringify([carrier.company_id, carrier.vehicle_type_id]))) {
      throw new Error('Наличността на фирмите не е потвърдена.');
    }
    pairs.add(JSON.stringify([carrier.company_id, carrier.vehicle_type_id]));
  }
  return { ...base, carriers };
}
export function carrierAvailable(value: MarketplaceAvailability | undefined, offer: AvailableCarrier, now = Date.now()) {
  return availabilityFresh(value, now) && !!value?.carriers.some(carrier => carrier.company_id === offer.company_id
    && carrier.vehicle_type_id === offer.vehicle_type_id && carrier.service_class === offer.service_class);
}
export async function loadBookingAvailability(company: string, lat: number, lng: number, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('booking_availability', { p_company: company, p_lat: lat, p_lng: lng }).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseBookingAvailability(data, company);
}
export async function loadMarketplaceAvailability(lat: number, lng: number, signal?: AbortSignal) {
  const { data, error } = await withRequestTimeout(abort => supabase.rpc('marketplace_availability', { p_lat: lat, p_lng: lng }).abortSignal(abort), 10_000, signal);
  if (error) throw error;
  return parseMarketplaceAvailability(data);
}
