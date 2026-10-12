import { expect, it } from 'vitest';
import { marketplaceQuotes, type MarketplaceTariff } from './marketplacePricing.ts';
const tariff = (id: string, company: string, base: number, cls = 'standard'): MarketplaceTariff => ({id,company_id:company,service_class:cls,multiplier:1,base_fare:base,price_per_km:1,price_per_minute:0,min_fare:0,currency:'EUR'});
const input = {customer:'customer',distanceMeters:1234,durationSeconds:123,origin:{lat:43.2,lng:25.6},destination:{lat:43.3,lng:25.7},pickupAddress:'A',destinationAddress:'B'};
it('quotes a single shared route for two firms and freezes each distinct tariff', () => {
  const rows = marketplaceQuotes([tariff('eco','firm-a',2),tariff('standard','firm-b',4),tariff('comfort','firm-a',2,'comfort')],input);
  expect(rows).toHaveLength(2);
  const standard = rows.find(r => r.payload.breakdown.marketplace.service_class === 'standard')!;
  expect(standard.payload.breakdown.marketplace).toMatchObject({min:3.23,max:5.23,offers:[{company_id:'firm-a',total:3.23},{company_id:'firm-b',total:5.23}]});
  expect(standard.company_id).toBe('firm-b');expect(standard.payload.total).toBe(5.23);
  expect(standard.payload.breakdown.marketplace.offers.every(o => o.breakdown.distanceKm === 1.234 && o.breakdown.durationMin === 2.05)).toBe(true);
});
it('keeps the minimum fare and unrounded raw measurements when producing ranges', () => {
  const a={...tariff('a','one',0),multiplier:1.3,min_fare:10};
  const row=marketplaceQuotes([a,tariff('b','two',0)],input)[0];
  expect(row.payload.breakdown.marketplace).toMatchObject({min:1.23,max:13});
});
it('rejects invalid, duplicate or unbounded tariffs instead of substituting a guessed price', () => {
  for(const list of [[],[tariff('a','a',NaN)],[{...tariff('a','a',0),currency:'BGN'}],[tariff('a','a',0),tariff('a','b',0)],Array.from({length:513},(_,i)=>tariff(String(i),'a',0))]) {
    expect(()=>marketplaceQuotes(list,input)).toThrow();
  }
});
