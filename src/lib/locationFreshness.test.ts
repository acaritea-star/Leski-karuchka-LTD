import { expect, it } from 'vitest';
import { confirmedLocationFresh } from './locationFreshness';

it('keeps a once-per-minute idle device available only within a bounded window', () => {
  for (const speed of [null, undefined, 0, 1.49]) {
    expect(confirmedLocationFresh(61_000, 61_000, speed)).toBe(true);
    expect(confirmedLocationFresh(89_999, 89_999, speed)).toBe(true);
    expect(confirmedLocationFresh(90_000, 0, speed)).toBe(false);
    expect(confirmedLocationFresh(0, 90_000, speed)).toBe(false);
  }
});
it('expires moving, invalid and future samples without refreshing their measurement time', () => {
  for (const speed of [1.5, 10, NaN, Infinity, -1]) {
    expect(confirmedLocationFresh(0, 44_999, speed)).toBe(true);
    expect(confirmedLocationFresh(0, 45_000, speed)).toBe(false);
  }
  expect(confirmedLocationFresh(-30_001, 0, 0)).toBe(false);
  expect(confirmedLocationFresh(0, -30_001, 0)).toBe(false);
  expect(confirmedLocationFresh(0, Infinity, 0)).toBe(false);
});
