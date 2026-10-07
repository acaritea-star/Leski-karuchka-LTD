import { describe, expect, it } from 'vitest';
import { parseVerificationReport } from './driverVerification';
describe('verification response isolation', () => {
  it.each([null, {}, { driver_id: 'another-driver', can_verify: true }, { driver_id: 'driver', can_verify: true, is_verified: false, blockers: [], warnings: [], documents: {} }])('rejects an incomplete or mismatched response', value => {
    expect(() => parseVerificationReport(value, 'driver')).toThrow();
  });
});
