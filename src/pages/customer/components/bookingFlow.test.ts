import { describe, expect, it } from 'vitest';
import { recentLocations, stepAfterSelection } from './bookingFlow';

describe('booking steps and stored addresses', () => {
  it('asks for the missing address and lets completed routes return straight to confirmation', () => {
    expect(stepAfterSelection('pickup', false)).toBe('dest');
    expect(stepAfterSelection('dest', false)).toBe('pickup');
    expect(stepAfterSelection('pickup', true)).toBe('confirm');
    expect(stepAfterSelection('dest', true)).toBe('confirm');
  });
  it('ignores malformed local history instead of crashing the customer screen', () => {
    const place = { id: 'a', address: 'Левски', name: 'Център', lat: 43.35, lng: 25.13 };
    expect(recentLocations({ address: 'broken' })).toEqual([]);
    expect(recentLocations([null, {}, place, { ...place, id: 'duplicate' }, { ...place, lat: 150 }])).toEqual([place]);
  });
});
