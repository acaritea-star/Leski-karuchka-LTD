import type { Json } from './database.types';
export const SERVICE_CLASSES = [
  { id: 'standard', name: 'Стандарт', capacity: 4 },
  { id: 'comfort', name: 'Комфорт', capacity: 4 },
  { id: 'van', name: 'Ван', capacity: 6 },
] as const;
export type ServiceClass = typeof SERVICE_CLASSES[number]['id'];
export type PriceRange = { min: number; max: number };
/** Trusted server snapshot still gets checked before displaying any amount. */
export function marketplaceRange(value: Json | undefined | null): PriceRange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const market = value.marketplace;
  if (!market || typeof market !== 'object' || Array.isArray(market)) return null;
  const { min, max } = market;
  return typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max)
    && min >= 0 && max >= min ? { min, max } : null;
}
export function displayPriceRange(range: PriceRange): string {
  return range.min === range.max ? range.min.toFixed(2) : `${range.min.toFixed(2)}–${range.max.toFixed(2)}`;
}
export function carrierChoiceName(value: Json | undefined | null): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const choice = value.carrier_choice;
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return null;
  return typeof choice.company_name === 'string' && choice.company_name.trim() ? choice.company_name.trim() : null;
}

/** Only complete exact server quotes can be shown as selectable carriers. */
export function carrierOffers(route: import('./googleMaps').RouteResult | null, serviceClass: string): import('./googleMaps').CarrierOffer[] {
  return (route?.quotes ?? []).filter((q): q is import('./googleMaps').CarrierOffer => q.service_class === serviceClass
    && typeof q.company_id === 'string' && !!q.company_id && typeof q.company_name === 'string' && !!q.company_name.trim()
    && typeof q.type_name === 'string' && !!q.type_name.trim() && typeof q.capacity === 'number' && Number.isInteger(q.capacity)
    && q.capacity >= 1 && q.capacity <= 8 && Number.isFinite(q.price) && q.price >= 0
    && q.breakdown?.total === q.price && Number.isFinite(Date.parse(q.quote_expires_at)))
    .sort((a,b) => a.price - b.price || a.company_id.localeCompare(b.company_id) || a.vehicle_type_id.localeCompare(b.vehicle_type_id));
}
export const carrierOfferKey = (offer: Pick<import('./googleMaps').CarrierOffer,'company_id'|'vehicle_type_id'>) => `${offer.company_id}:${offer.vehicle_type_id}`;
