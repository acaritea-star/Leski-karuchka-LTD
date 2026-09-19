import type { LocationPreset } from '@/lib/geo';

export type BookingStep = 'pickup' | 'dest' | 'confirm';

/** Editing an address must not repeat already completed steps. */
export function stepAfterSelection(field: 'pickup' | 'dest', hasOtherAddress: boolean): BookingStep {
  return hasOtherAddress ? 'confirm' : field === 'pickup' ? 'dest' : 'pickup';
}

export function recentLocations(value: unknown): LocationPreset[] {
  if (!Array.isArray(value)) return [];
  return value.filter((place): place is LocationPreset => !!place &&
    typeof place.id === 'string' && typeof place.address === 'string' &&
    typeof place.name === 'string' && Number.isFinite(place.lat) && Number.isFinite(place.lng) &&
    Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180)
    .filter((place, index, all) => all.findIndex(other => other.address === place.address) === index)
    .slice(0, 5);
}
