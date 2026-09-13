import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRICING,
  DEFAULT_BASE_FARE,
  DEFAULT_PRICE_PER_KM,
  DEFAULT_PRICE_PER_MINUTE,
  roundCurrency,
  pricingFromRow,
  applyVehicleMultiplier,
  calculateFare,
} from '@/lib/pricing';

describe('roundCurrency', () => {
  it('rounds to two decimals', () => {
    expect(roundCurrency(2)).toBe(2);
    expect(roundCurrency(2.5)).toBe(2.5);
    expect(roundCurrency(0)).toBe(0);
    expect(roundCurrency(3.14159)).toBe(3.14);
  });
});

describe('calculateFare', () => {
  it('computes the default fare for a known trip', () => {
    // 3 km, 6 min → 2.00 + 3*1.10 + 6*0.28 = 6.98
    const fare = calculateFare({ distanceKm: 3, durationMin: 6 });

    expect(fare.distanceKm).toBe(3);
    expect(fare.durationMin).toBe(6);
    expect(fare.baseFare).toBe(2);
    expect(fare.perKm).toBe(1.1);
    expect(fare.perMin).toBe(0.28);
    expect(fare.distanceCost).toBe(3.3);
    expect(fare.timeCost).toBe(1.68);
    expect(fare.total).toBe(6.98);
  });

  it('charges only the base fare for a zero-length trip', () => {
    const fare = calculateFare({ distanceKm: 0, durationMin: 0 });

    expect(fare.distanceCost).toBe(0);
    expect(fare.timeCost).toBe(0);
    expect(fare.total).toBe(2);
  });

  it('clamps negative distance/duration to zero', () => {
    const fare = calculateFare({ distanceKm: -5, durationMin: -10 });

    expect(fare.distanceKm).toBe(0);
    expect(fare.durationMin).toBe(0);
    expect(fare.total).toBe(2);
  });

  it('accepts a partial config override', () => {
    // 10 km, 0 min, perKm=2 → 2.00 + 20.00 + 0 = 22.00
    const fare = calculateFare({ distanceKm: 10, durationMin: 0, config: { perKm: 2 } });

    expect(fare.baseFare).toBe(2);
    expect(fare.perKm).toBe(2);
    expect(fare.distanceCost).toBe(20);
    expect(fare.timeCost).toBe(0);
    expect(fare.total).toBe(22);
  });

  it('applies a vehicle multiplier end-to-end (comfort)', () => {
    const comfort = applyVehicleMultiplier(DEFAULT_PRICING, 1.4);
    // 3 km, 6 min comfort → 2.80 + 3*1.54 + 6*0.39 = 9.76
    const fare = calculateFare({ distanceKm: 3, durationMin: 6, config: comfort });

    expect(fare.baseFare).toBe(2.8);
    expect(fare.perKm).toBe(1.54);
    expect(fare.perMin).toBe(0.39);
    expect(fare.total).toBe(9.76);
  });
});

describe('pricingFromRow', () => {
  it('falls back to defaults for a null row', () => {
    expect(pricingFromRow(null)).toEqual(DEFAULT_PRICING);
  });

  it('maps a snake_case DB row to camelCase', () => {
    expect(pricingFromRow({ base_fare: '3.00', price_per_km: '1.50', price_per_minute: '0.30' }))
      .toEqual({ baseFare: 3, perKm: 1.5, perMin: 0.3 });
  });

  it('falls back to defaults for invalid or negative values', () => {
    expect(pricingFromRow({ base_fare: -5, price_per_km: 'abc', price_per_minute: null }))
      .toEqual({
        baseFare: DEFAULT_BASE_FARE,
        perKm: DEFAULT_PRICE_PER_KM,
        perMin: DEFAULT_PRICE_PER_MINUTE,
      });
  });
});

describe('applyVehicleMultiplier', () => {
  it('scales every component by the multiplier', () => {
    expect(applyVehicleMultiplier(DEFAULT_PRICING, 1.4))
      .toEqual({ baseFare: 2.8, perKm: 1.54, perMin: 0.39 });
  });

  it('ignores invalid multipliers (falls back to 1x)', () => {
    expect(applyVehicleMultiplier(DEFAULT_PRICING, 0)).toEqual(DEFAULT_PRICING);
    expect(applyVehicleMultiplier(DEFAULT_PRICING, NaN)).toEqual(DEFAULT_PRICING);
    expect(applyVehicleMultiplier(DEFAULT_PRICING, -2)).toEqual(DEFAULT_PRICING);
  });
});
describe('server/client price parity', () => {
  it('uses the database Comfort multiplier, including rounding each tariff', () => {
    const config = applyVehicleMultiplier(pricingFromRow({base_fare:2.2,price_per_km:0.79,price_per_minute:0.19}),1.3);
    expect(calculateFare({distanceKm:10,durationMin:20,config}).total).toBe(18.16);
  });
  it('handles non-finite route values without NaN prices', () => {
    expect(Number.isFinite(calculateFare({distanceKm:NaN,durationMin:Infinity}).total)).toBe(true);
  });
});
