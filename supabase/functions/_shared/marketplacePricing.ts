import { calculateFare, applyVehicleMultiplier, pricingFromRow, type PricingRow } from './pricing.ts';
export type MarketplaceTariff = PricingRow & { company_name?: string; type_name?: string; capacity?: number; id: string; company_id: string; service_class: string; multiplier: number; currency: string; tariff_period?: 'day' | 'night'; priced_at?: string };
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
      || !Number.isFinite(Number(type.multiplier)) || Number(type.multiplier) <= 0
      || type.tariff_period != null && (!['day','night'].includes(type.tariff_period) || !type.priced_at || !Number.isFinite(Date.parse(type.priced_at)))) throw new Error('Invalid marketplace tariff');
    ids.add(type.id);
    const breakdown = { ...calculateFare({ distanceKm: input.distanceMeters / 1000, durationMin: input.durationSeconds / 60,
      distanceMeters: input.distanceMeters, durationSeconds: input.durationSeconds,
      config: applyVehicleMultiplier(pricingFromRow(type), Number(type.multiplier)) }),
      ...(type.tariff_period ? { tariff_period: type.tariff_period, priced_at: type.priced_at } : {}) };
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

/** Exact carrier quotes share a route but never share a booking or fare. */
export function carrierQuotes(types: MarketplaceTariff[], input: Parameters<typeof marketplaceQuotes>[1]) {
  const priced = marketplaceQuotes(types, input);
  return priced.flatMap(group => group.payload.breakdown.marketplace.offers.map(offer => {
    const type = types.find(type => type.id === offer.vehicle_type_id)!;
    if (!type.company_name?.trim() || !type.type_name?.trim() || !Number.isInteger(type.capacity) || type.capacity! < 1 || type.capacity! > 8)
      throw new Error('Carrier identity unavailable');
    return { id: crypto.randomUUID(), customer_id: input.customer, company_id: offer.company_id, vehicle_type_id: offer.vehicle_type_id,
      payload: { ...group.payload, total: offer.total, breakdown: { ...offer.breakdown,
        carrier_choice: { service_class: type.service_class, company_name: type.company_name, type_name: type.type_name, capacity: type.capacity! } } } };
  })).sort((a,b) => a.payload.total - b.payload.total || a.company_id.localeCompare(b.company_id) || a.vehicle_type_id.localeCompare(b.vehicle_type_id));
}
