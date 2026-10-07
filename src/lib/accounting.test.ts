import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { csvCell, monthBounds, parseMoney, reportCsv, sofiaMonth, type Outcome, type MoneyEntry } from './accounting';
describe('accounting', () => {
 it('uses Sofia month around UTC midnight and handles December rollover', () => {
  expect(sofiaMonth(new Date('2026-09-30T22:00:00Z'))).toBe('2026-10');
  expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', until: '2027-01-01' });
  expect(() => monthBounds('2026-13')).toThrow();
 });
 it('accepts decimal comma and rejects imprecise, negative or nonfinite money', () => {
  expect(parseMoney('12,34')).toBe(12.34);
  for (const value of ['0','-2','1.234','NaN','Infinity','1000001','1e3','12abc']) expect(() => parseMoney(value)).toThrow();
 });
 it('neutralizes spreadsheet formulas and escapes CSV quotes', () => {
  expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
  expect(csvCell(' +command')).toBe('"\' +command"');
  expect(csvCell('a"b')).toBe('"a""b"');
 });
 it('never reports a cancelled quote as earned money', () => {
  const cancelled = { id:'event', request_id:'request', driver_name:'Driver', driver_id:'driver', outcome:'cancelled', previous_status:'accepted', cancelled_by:'customer', occurred_at:'2026-10-03T12:00:00Z', booked_amount:999, reconstructed:false } as Outcome;
  const csv = reportCsv([cancelled], []);
  expect(csv).toContain('Отменена заявка');
  expect(csv).not.toContain('999');
  expect(csv).toContain('На път към клиента');
 });
 it('exports evidence references without allowing spreadsheet formulas to execute',()=>{
  const row={id:'entry',kind:'confirmation',amount:10,recorded_at:'2026-10-04T12:00:00Z',evidence_source:'receipt',evidence_reference:'=BAD()',note:'Verified'} as MoneyEntry;
  const csv=reportCsv([],[row]);expect(csv).toContain('Разписка / документ');expect(csv).toContain('"\'=BAD()"');
 });
});
