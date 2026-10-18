import { expect, it } from 'vitest';
import { parseDivision, parseDivisionReport, validateDivisionDraft } from './companyDivisions';

const division = () => ({ id: 'city', parent_company_id: 'parent', name: 'Лески — град', service_city: 'Левски', service_latitude: 43.3592, service_longitude: 25.1358, service_radius_km: 5,
  is_active: false, setup_completed_at: null, updated_at: '2026-10-18T10:00:00Z', base_fare: 0, price_per_km: 0, night_base_fare: null, night_price_per_km: null });
const summary = () => ({ completed: 1, cancelled: 0, income: 15.15, expenses: 2, handed_over: 3, cash_income: 10.10, card_income: 5.05, unknown_income: 0, cash_closing: 5.10 });
const report = () => ({ report_version: 1, parent_company_id: 'parent', currency: 'EUR', period: { from: '2026-10-01', until: '2026-11-01', timezone: 'Europe/Sofia' }, generated_at: '2026-10-18T10:00:00Z',
  companies: [{ id: 'parent', parent_company_id: null, name: 'Централа', service_city: null, is_active: false, summary: Object.fromEntries(Object.keys(summary()).map(k => [k, 0])) },
    { id: 'city', parent_company_id: 'parent', name: 'Град', service_city: 'Левски', is_active: true, summary: summary() }], total: summary() });

it('accepts a real draft without pretending that zero default prices are an active offer', () => { expect(parseDivision(division(), 'parent').is_active).toBe(false); });
it.each([{ parent_company_id: 'foreign' }, { service_latitude: 51.5 }, { service_radius_km: 50 }, { night_price_per_km: NaN }, { updated_at: '' }])('rejects foreign or malformed branch data %s', patch => {
  expect(() => parseDivision({ ...division(), ...patch }, 'parent')).toThrow();
});
it('normalizes city spacing without changing the selected point or inventing prices', () => {
  expect(validateDivisionDraft({ name: '  Лески — Търново ', service_city: ' Велико   Търново ', service_latitude: 43.0757, service_longitude: 25.6172, service_radius_km: 5 })).toMatchObject({ name: 'Лески — Търново', service_city: 'Велико Търново' });
});
it.each([NaN, Infinity, 0, 30.01])('rejects unsupported service radii %s', radius => {
  expect(() => validateDivisionDraft({ name: 'Град', service_city: 'Левски', service_latitude: 43.3592, service_longitude: 25.1358, service_radius_km: radius })).toThrow();
});
it('verifies the parent, local period and exact payment totals before displaying an aggregate', () => {
  expect(parseDivisionReport(report(), 'parent', '2026-10').total.income).toBe(15.15);
});
it('rejects an aggregate from another parent or another month', () => {
  expect(() => parseDivisionReport(report(), 'foreign', '2026-10')).toThrow();
  expect(() => parseDivisionReport(report(), 'parent', '2026-09')).toThrow();
});
it('rejects a sibling from a foreign group even if the reported totals match', () => {
  const data = report(); data.companies[1].parent_company_id = 'foreign';
  expect(() => parseDivisionReport(data, 'parent', '2026-10')).toThrow();
});
it('rejects repeated divisions and aggregate differences of one cent', () => {
  const data = report(); data.companies.push(data.companies[1]); expect(() => parseDivisionReport(data, 'parent', '2026-10')).toThrow();
  const wrong = report(); wrong.total.expenses += .01; expect(() => parseDivisionReport(wrong, 'parent', '2026-10')).toThrow();
});
it('keeps late reversals negative instead of hiding them or calling them zero income', () => {
  const data = report(), negative = { ...summary(), income: -10.10, cash_income: -10.10, card_income: 0, cash_closing: -15.10 };
  data.companies[1].summary = negative; data.total = negative;
  expect(parseDivisionReport(data, 'parent', '2026-10').total.income).toBe(-10.10);
});
