import type { AccountingReport, MoneyEntry, Outcome } from '../../src/lib/accounting';
export const financeIds = { account: '11111111-1111-4111-8111-111111111111', company: '22222222-2222-4222-8222-222222222222', driver: '33333333-3333-4333-8333-333333333333', request: '44444444-4444-4444-8444-444444444444', entry: '55555555-5555-4555-8555-555555555555' };
export function accountingFixture(month = '2026-10', driver: string | null = financeIds.driver): AccountingReport {
 return { report_version: 2, currency: 'EUR', generated_at: `${month}-10T10:00:00Z`, period: { from: `${month}-01`, until: month === '2026-09' ? '2026-10-01' : '2026-11-01', timezone: 'Europe/Sofia' }, scope: { company_id: financeIds.company, driver_id: driver },
  totals: { completed: 0, cancelled: 0, interrupted: 0, booked: 0, missing_amounts: 0, unreported_completed: 0 },
  finances: { income: 0, expenses: 0, handed_over: 0, confirmed_handover: 0, confirmed_income: 0, net_income: 0 },
  balance: { opening: 0, movement: 0, closing: 0, unconfirmed_handover: 0, unconfirmed_income: 0 },
  outcome_count: 0, entry_count: 0, driver_count: 0, outcomes: [], entries: [], reconciliation: [], drivers: [] };
}
export function outcomeFixture(): Outcome {
 return { id: 'event', request_id: financeIds.request, driver_id: financeIds.driver, driver_name: 'Тест Водач', outcome: 'completed', previous_status: 'in_progress', cancelled_by: null, cancel_reason: null, occurred_at: '2026-10-09T09:00:00Z', accepted_at: '2026-10-09T08:40:00Z', started_at: '2026-10-09T08:45:00Z', booked_amount: 12.34, estimated_distance_km: 2, reconstructed: false };
}
export function entryFixture(): MoneyEntry {
 return { id: financeIds.entry, driver_id: financeIds.driver, driver_user_id: financeIds.account, actor_id: financeIds.account, driver_name: 'Тест Водач', kind: 'income', amount: 12.34, note: 'Плащане', request_id: financeIds.request, reference_id: null, recorded_at: '2026-10-09T09:01:00Z', reversed: false, confirmed: false, reference_kind: null, reference_recorded_at: null, signed_amount: 12.34, balance_delta: 12.34, reversed_at: null, confirmed_at: null, evidence_source: 'declaration', evidence_reference: null };
}
export function addUnpaidRide(report: AccountingReport) {
 report.outcomes = [outcomeFixture()]; report.outcome_count = 1;
 report.totals.completed = 1; report.totals.booked = 12.34; report.totals.unreported_completed = 1;
 report.reconciliation = [{ request_id: financeIds.request, estimated_amount: 12.34, declared_income: null, income_recorded_at: null, company_confirmed: false, difference: null }];
 return report;
}
