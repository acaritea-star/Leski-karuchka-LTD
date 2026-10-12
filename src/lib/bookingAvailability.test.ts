import { expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { availabilityFresh, parseBookingAvailability } from './bookingAvailability';
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
