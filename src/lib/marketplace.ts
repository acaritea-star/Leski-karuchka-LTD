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
