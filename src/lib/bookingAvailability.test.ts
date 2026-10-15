import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { availabilityFresh, carrierAvailable, parseBookingAvailability, parseMarketplaceAvailability } from './bookingAvailability';
const sample = () => ({ company_id:'company',sampled_at:new Date().toISOString(),categories:[{id:'eco',drivers:1,configured:true},{id:'comfort',drivers:0,configured:false}] });
it('preserves the distinction between active tariffs and actually reachable drivers', () => {
  const result = parseBookingAvailability(sample(),'company');
  expect(result.categories[1]).toMatchObject({ drivers:0,configured:false });
  expect(availabilityFresh(result)).toBe(true);
});
it('fails closed on another operator, duplicate categories or invalid counts', () => {
  expect(()=>parseBookingAvailability(sample(),'other')).toThrow();
  expect(()=>parseBookingAvailability({...sample(),categories:[sample().categories[0],sample().categories[0]]},'company')).toThrow();
  expect(()=>parseBookingAvailability({...sample(),categories:[{id:'eco',drivers:-1,configured:true}]},'company')).toThrow();
});
it('does not keep an expired or future availability snapshot bookable', () => {
  const data = sample(); expect(availabilityFresh(data,Date.now()+31_000)).toBe(false);
  expect(availabilityFresh({...data,sampled_at:new Date(Date.now()+60_000).toISOString()})).toBe(false);
  expect(availabilityFresh(undefined)).toBe(false);
});
const carrier = { company_id: 'orion', vehicle_type_id: 'eco', service_class: 'standard' };
const market = () => ({ company_id: 'marketplace', sampled_at: new Date().toISOString(), categories: [{id:'standard',drivers:2,configured:true}], carriers: [carrier] });
it('requires a fresh matching company, vehicle type and category rather than category totals', () => {
  const data = parseMarketplaceAvailability(market());
  expect(carrierAvailable(data, carrier)).toBe(true);
  expect(carrierAvailable(data, {...carrier,company_id:'another'})).toBe(false);
  expect(carrierAvailable(data, {...carrier,vehicle_type_id:'comfort'})).toBe(false);
  expect(carrierAvailable(data, {...carrier,service_class:'van'})).toBe(false);
  expect(carrierAvailable(data, carrier, Date.now()+31_000)).toBe(false);
  expect(carrierAvailable(parseMarketplaceAvailability({...market(),carriers:[]}), carrier)).toBe(false);
});
it('fails closed on missing, duplicate, malformed or inconsistent carrier readiness', () => {
  for (const carriers of [undefined, null, {}, [null], [carrier, carrier], [{...carrier,vehicle_type_id:''}], [{...carrier,service_class:'van'}]]) {
    expect(() => parseMarketplaceAvailability({...market(),carriers})).toThrow();
  }
  expect(() => parseMarketplaceAvailability({...market(),categories:[{id:'standard',drivers:0,configured:false}]})).toThrow();
});
