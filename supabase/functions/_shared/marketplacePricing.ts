import { calculateFare, applyVehicleMultiplier, pricingFromRow, type PricingRow } from './pricing.ts';
export type MarketplaceTariff = PricingRow & { id: string; company_id: string; service_class: string; multiplier: number; currency: string };
export function marketplaceQuotes(types: MarketplaceTariff[], input: {
  customer: string; distanceMeters: number; durationSeconds: number;
  origin: { lat: number; lng: number }; destination: { lat: number; lng: number };
  pickupAddress: string; destinationAddress: string;
}) {
  const groups = new Map<string, Array<{ company_id: string; vehicle_type_id: string; total: number; breakdown: ReturnType<typeof calculateFare> }>>();
  const ids = new Set<string>();
  if (!types.length || types.length > 512) throw new Error('Marketplace tariffs unavailable');
  for (const type of types) {
    if (!['standard', 'comfort', 'van'].includes(type.service_class) || type.currency !== 'EUR' || ids.has(type.id)
      || ![type.base_fare, type.price_per_km, type.price_per_minute, type.min_fare].every(n => n != null && Number.isFinite(Number(n)) && Number(n) >= 0)
      || !Number.isFinite(Number(type.multiplier)) || Number(type.multiplier) <= 0) throw new Error('Invalid marketplace tariff');
    ids.add(type.id);
    const breakdown = calculateFare({ distanceKm: input.distanceMeters / 1000, durationMin: input.durationSeconds / 60,
      distanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds,
      config: applyVehicleMultiplier(pricingFromRow(type), Number(type.multiplier)) });
    const offers = groups.get(type.service_class) ?? [];
    offers.push({ company_id: type.company_id, vehicle_type_id: type.id, total: breakdown.total, breakdown });
    groups.set(type.service_class, offers);
  }
  return [...groups].map(([serviceClass, offers]) => {
    offers.sort((a, b) => a.total - b.total || a.vehicle_type_id.localeCompare(b.vehicle_type_id));
    const high = offers[offers.length - 1];
    const marketplace = { service_class: serviceClass, min: offers[0].total, max: high.total, offers };
    return { id: crypto.randomUUID(), customer_id: input.customer, company_id: high.company_id, vehicle_type_id: high.vehicle_type_id,
      payload: { pickup_latitude: input.origin.lat, pickup_longitude: input.origin.lng,
        destination_latitude: input.destination.lat, destination_longitude: input.destination.lng,
        pickup_address: input.pickupAddress.slice(0, 500), destination_address: input.destinationAddress.slice(0, 500),
        distance_km: high.breakdown.distanceKm, duration_min: Math.ceil(input.durationSeconds / 60), total: high.total,
        breakdown: { ...high.breakdown, marketplace } } };
  });
}
