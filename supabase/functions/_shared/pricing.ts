/** Fixed quotes in EUR. Keep decimal arithmetic exact until the final cent.
 * Mirrored in the Edge bundle; a parity test protects both copies.
 */
export const DEFAULT_CURRENCY = 'EUR';
export const PRICING_VERSION = 'fixed-fare-v2';
export const DEFAULT_BASE_FARE = 2.0;
export const DEFAULT_PRICE_PER_KM = 1.1;
export const DEFAULT_PRICE_PER_MINUTE = 0.28;
export interface PricingConfig {
  baseFare: number; perKm: number; perMin: number;
  minFare?: number; multiplier?: number;
}
export const DEFAULT_PRICING: PricingConfig = {
  baseFare: DEFAULT_BASE_FARE, perKm: DEFAULT_PRICE_PER_KM, perMin: DEFAULT_PRICE_PER_MINUTE,
};
export interface PricingRow {
  base_fare?: unknown; price_per_km?: unknown; price_per_minute?: unknown; min_fare?: unknown;
}
export interface FareBreakdown {
  distanceKm: number; durationMin: number; baseFare: number; perKm: number; perMin: number;
  distanceCost: number; timeCost: number; total: number;
  pricingVersion?: string; minimumFare?: number; minimumApplied?: boolean; multiplier?: number;
  roundingAdjustment?: number;
}
export interface FareInput {
  distanceKm: number; durationMin: number; config?: Partial<PricingConfig>;
  /** Provider's raw units: no rounded kilometres or whole minutes in the fare. */
  distanceMeters?: number; durationSeconds?: number;
}
function nonNegative(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
type Fraction = { n: bigint; d: bigint };
function decimal(value: number): Fraction {
  const [digits, exponent = '0'] = value.toString().toLowerCase().split('e');
  const [whole, fraction = ''] = digits.split('.');
  const scale = fraction.length - Number(exponent);
  const n = BigInt(whole + fraction);
  return scale >= 0 ? { n, d: 10n ** BigInt(scale) } : { n: n * 10n ** BigInt(-scale), d: 1n };
}
const multiply = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.n, d: a.d * b.d });
const add = (a: Fraction, b: Fraction): Fraction => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const numeric = (a: Fraction) => Number(a.n) / Number(a.d);
function cents(value: Fraction): number {
  const rounded = (value.n * 200n + value.d) / (value.d * 2n);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fare exceeds the supported amount');
  return Number(rounded) / 100;
}
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Invalid money amount');
  return value < 0 ? -cents(decimal(-value)) : cents(decimal(value));
}
export function pricingFromRow(row: PricingRow | null | undefined): PricingConfig {
  if (!row) return { ...DEFAULT_PRICING };
  return {
    baseFare: nonNegative(row.base_fare, DEFAULT_BASE_FARE),
    perKm: nonNegative(row.price_per_km, DEFAULT_PRICE_PER_KM),
    perMin: nonNegative(row.price_per_minute, DEFAULT_PRICE_PER_MINUTE),
    ...(row.min_fare != null ? { minFare: nonNegative(row.min_fare, 0) } : {}),
  };
}
/** Carry the multiplier separately: do not round each scaled unit tariff. */
export function applyVehicleMultiplier(config: PricingConfig, multiplier: number): PricingConfig {
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return m === 1 ? { ...config } : { ...config, multiplier: (config.multiplier ?? 1) * m };
}
export function calculateFare(input: FareInput): FareBreakdown {
  const config = { ...DEFAULT_PRICING, ...input.config };
  const km = input.distanceMeters == null ? decimal(nonNegative(input.distanceKm, 0))
    : multiply(decimal(nonNegative(input.distanceMeters, 0)), { n: 1n, d: 1000n });
  const minutes = input.durationSeconds == null ? decimal(nonNegative(input.durationMin, 0))
    : multiply(decimal(nonNegative(input.durationSeconds, 0)), { n: 1n, d: 60n });
  const multiplier = config.multiplier != null && Number.isFinite(config.multiplier) && config.multiplier > 0 ? config.multiplier : 1;
  const scale = decimal(multiplier);
  const base = multiply(decimal(nonNegative(config.baseFare, DEFAULT_BASE_FARE)), scale);
  const perKm = multiply(decimal(nonNegative(config.perKm, DEFAULT_PRICE_PER_KM)), scale);
  const perMin = multiply(decimal(nonNegative(config.perMin, DEFAULT_PRICE_PER_MINUTE)), scale);
  const distance = multiply(km, perKm), time = multiply(minutes, perMin);
  const sum = add(add(base, distance), time);
  const minimum = multiply(decimal(nonNegative(config.minFare, 0)), scale);
  const minimumApplied = minimum.n * sum.d > sum.n * minimum.d;
  const total = cents(minimumApplied ? minimum : sum);
  const distanceCost = cents(distance), timeCost = cents(time);
  return {
    distanceKm: numeric(km), durationMin: numeric(minutes), baseFare: numeric(base), perKm: numeric(perKm), perMin: numeric(perMin),
    distanceCost, timeCost, total, pricingVersion: PRICING_VERSION, multiplier,
    minimumFare: numeric(minimum), minimumApplied,
    // Display components can differ by one cent; never use them to bill.
    roundingAdjustment: minimumApplied ? 0 : roundCurrency(total - cents(base) - distanceCost - timeCost),
  };
}
