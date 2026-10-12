import { expect, it } from 'vitest';
import { marketplaceRange, displayPriceRange } from './marketplace';
it('only displays a finite ordered server price range', () => {
  expect(marketplaceRange({marketplace:{min:10,max:12}})).toEqual({min:10,max:12});
  for(const value of [null,{}, {marketplace:{min:-1,max:2}},{marketplace:{min:3,max:2}},{marketplace:{min:'2',max:3}}]) expect(marketplaceRange(value)).toBeNull();
  expect(displayPriceRange({min:10,max:12})).toBe('10.00–12.00');expect(displayPriceRange({min:10,max:10})).toBe('10.00');
});
