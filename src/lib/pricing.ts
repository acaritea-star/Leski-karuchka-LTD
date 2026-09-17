/**
 * Pricing module — the single source of truth for fare calculation.
 *
 * Input  → distance (km), duration (min) and an optional tariff config.
 * Output → a full breakdown (base fare, distance cost, time cost, total).
 *
 * Currency is EUR everywhere (see project_plan.md §9.1).
 */

export const DEFAULT_CURRENCY = 'EUR';

export const DEFAULT_BASE_FARE = 2.0;
export const DEFAULT_PRICE_PER_KM = 1.1;
export const DEFAULT_PRICE_PER_MINUTE = 0.28;

/** Normalized, camelCase tariff configuration. */
export interface PricingConfig {
  baseFare: number;
  perKm: number;
  perMin: number;
}

/** Default tariffs (matches the seeded company configuration). */
export const DEFAULT_PRICING: PricingConfig = {
  baseFare: DEFAULT_BASE_FARE,
  perKm: DEFAULT_PRICE_PER_KM,
  perMin: DEFAULT_PRICE_PER_MINUTE,
};

/** Raw database row shape (snake_case) from the `companies` table. */
export interface PricingRow {
  base_fare?: unknown;
  price_per_km?: unknown;
  price_per_minute?: unknown;
}

/** The complete result of a fare calculation. */
export interface FareBreakdown {
  distanceKm: number;
  durationMin: number;
  baseFare: number;
  perKm: number;
  perMin: number;
  distanceCost: number;
  timeCost: number;
  total: number;
}

export interface FareInput {
  distanceKm: number;
  durationMin: number;
  config?: Partial<PricingConfig>;
}

/** Round to two decimals (money-safe). */
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Parse a numeric-ish value into a non-negative number, with a fallback. */
function toNonNegative(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Normalize a snake_case DB row into a camelCase PricingConfig. */
export function pricingFromRow(row: PricingRow | null | undefined): PricingConfig {
  if (!row) return { ...DEFAULT_PRICING };
  return {
    baseFare: toNonNegative(row.base_fare, DEFAULT_BASE_FARE),
    perKm: toNonNegative(row.price_per_km, DEFAULT_PRICE_PER_KM),
    perMin: toNonNegative(row.price_per_minute, DEFAULT_PRICE_PER_MINUTE),
  };
}

/** Scale every tariff component by a vehicle-type multiplier. */
export function applyVehicleMultiplier(config: PricingConfig, multiplier: number): PricingConfig {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return {
    baseFare: roundCurrency(config.baseFare * m),
    perKm: roundCurrency(config.perKm * m),
    perMin: roundCurrency(config.perMin * m),
  };
}

/** Calculate the full fare breakdown from distance + duration + tariffs. */
export function calculateFare(input: FareInput): FareBreakdown {
  const config: PricingConfig = { ...DEFAULT_PRICING, ...(input.config ?? {}) };
  const distanceKm = toNonNegative(input.distanceKm, 0);
  const durationMin = toNonNegative(input.durationMin, 0);

  const baseFare = Math.max(0, roundCurrency(config.baseFare));
  const perKm = Math.max(0, roundCurrency(config.perKm));
  const perMin = Math.max(0, roundCurrency(config.perMin));
  const distanceCost = roundCurrency(distanceKm * perKm);
  const timeCost = roundCurrency(durationMin * perMin);
  const total = roundCurrency(baseFare + distanceCost + timeCost);

  return { distanceKm, durationMin, baseFare, perKm, perMin, distanceCost, timeCost, total };
}