import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: {} }));
import { parseAccountingReport, csvCell, monthBounds, parseMoney, reportCsv, sofiaMonth, type Outcome, type MoneyEntry } from './accounting';
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

import { accountingFixture, entryFixture, financeIds } from '../../tests/fixtures/accounting';
it('rejects a wrong scope, period, old report, nonfinite money, broken balance and truncated export', () => {
 const scope = { driverId: financeIds.driver };
 expect(parseAccountingReport(accountingFixture(), '2026-10', scope).balance.closing).toBe(0);
 const invalid = [
  { scope: { company_id: financeIds.company, driver_id: 'foreign' } },
  { period: { from: '2026-09-01', until: '2026-10-01', timezone: 'Europe/Sofia' } },
  { report_version: 1 },
  { finances: { ...accountingFixture().finances, income: NaN } },
  { balance: { ...accountingFixture().balance, closing: 0.01 } },
  { finances: { ...accountingFixture().finances, net_income: 1.001 } },
  { entry_count: 1, entries: [] },
 ];
 for (const change of invalid) expect(() => parseAccountingReport({ ...accountingFixture(), ...change }, '2026-10', scope, 0, true)).toThrow('не може да бъде проверен');
});
it('preserves a negative correction as a numeric CSV amount and zero cash movement for a confirmation', () => {
 const r = accountingFixture(); const correction = { ...entryFixture(), kind: 'reversal' as const, amount: 12.34, reference_kind: 'income' as const, reference_id: 'original', reference_recorded_at: '2026-09-20T09:00:00Z', signed_amount: -12.34, balance_delta: -12.34 };
 r.entry_count = 1; r.entries = [correction]; r.finances.income = -12.34; r.finances.net_income = -12.34;
 r.balance = { ...r.balance, opening: 12.34, movement: -12.34, closing: 0 };
 expect(parseAccountingReport(r, '2026-10', { driverId: financeIds.driver }).finances.income).toBe(-12.34);
 const csv = reportCsv([], [correction], r);
 expect(csv).toContain('"-12.34"'); expect(csv).not.toContain('"\'-12.34"');
 expect(csv).toContain('Движение на остатъка EUR');
 const confirmation = { ...entryFixture(), kind: 'confirmation' as const, signed_amount: 0, balance_delta: 0, reference_kind: 'income' as const, reference_id: 'original' };
 expect(reportCsv([], [confirmation]).split('\r\n')[1]).toMatch(/;"0"$/);
});
