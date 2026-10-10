import { evidenceDescription, evidenceFlagLabels, type RideEvidence } from './rideEvidence';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export interface Outcome {
 evidence?: RideEvidence|null;
 id: string; request_id: string; driver_id: string | null; driver_name: string;
 outcome: 'completed' | 'cancelled'; previous_status: string; cancelled_by: string | null;
 cancel_reason: string | null; occurred_at: string; accepted_at: string | null;
 started_at: string | null; booked_amount: number | null; estimated_distance_km: number | null; reconstructed: boolean;
}
export interface MoneyEntry {
 id: string; driver_id: string | null; driver_user_id: string; actor_id: string | null; driver_name: string;
 kind: 'income' | 'expense' | 'handover' | 'confirmation' | 'reversal'; amount: number;
 note: string; request_id: string | null; reference_id: string | null; recorded_at: string;
 reversed: boolean; confirmed: boolean;
 reference_kind: 'income' | 'expense' | 'handover' | null; reference_recorded_at: string | null;
 signed_amount: number; balance_delta: number; reversed_at: string | null; confirmed_at: string | null;
 evidence_source?: string; evidence_reference?: string | null;
}
export interface AccountingReport {
 report_version: 2; currency: 'EUR'; generated_at: string;
 period: { from: string; until: string; timezone: 'Europe/Sofia' }; scope: { company_id: string; driver_id: string | null };
 totals: { completed: number; cancelled: number; interrupted: number; booked: number; missing_amounts: number; unreported_completed: number };
 finances: { income: number; expenses: number; handed_over: number; confirmed_handover: number; confirmed_income: number; net_income: number };
 balance: { opening: number; movement: number; closing: number; unconfirmed_handover: number; unconfirmed_income: number };
 driver_count: number; outcome_count: number; entry_count: number; outcomes: Outcome[]; entries: MoneyEntry[];
 reconciliation: { request_id:string; estimated_amount:number|null; declared_income:number|null; income_recorded_at:string|null; company_confirmed:boolean; difference:number|null }[];
 drivers: { driver_id: string | null; driver_name: string; trips: number; cancelled: number; booked: number; income: number; expenses: number; handed_over: number; confirmed_income: number; confirmed_handover: number; closing: number }[];
}
export function sofiaMonth(now = new Date()): string {
 const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit' }).formatToParts(now);
 return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}`;
}
export function monthBounds(month: string) {
 if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Изберете валиден месец.');
 const [year, m] = month.split('-').map(Number);
 return { from: `${month}-01`, until: `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` };
}
export function parseMoney(value: string): number {
 if (!/^\d{1,7}([.,]\d{1,2})?$/.test(value.trim())) throw new Error('Въведете положителна сума с най-много две цифри след запетаята.');
 const amount = Number(value.trim().replace(',', '.'));
 if (amount <= 0 || amount > 1000000) throw new Error('Сумата трябва да е между 0,01 и 1 000 000 €.');
 return amount;
}
export const money = (value: number | null) => value == null ? 'Неизвестна сума' : `${Number(value).toFixed(2)} €`;
export const reportDate = (value: string) => new Date(value).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const stageLabels: Record<string, string> = { pending: 'Преди приемане', accepted: 'На път към клиента', arrived: 'След пристигане', in_progress: 'След начало на пътуването' };
export const actorLabels: Record<string, string> = { customer: 'Клиент', driver: 'Шофьор', admin: 'Администратор', system: 'Система' };
export const kindLabels: Record<MoneyEntry['kind'], string> = { income: 'Деклариран приход', expense: 'Деклариран разход', handover: 'Декларирано предаване', confirmation: 'Потвърждение от фирмата', reversal: 'Обратен запис' };
export const evidenceLabels: Record<string,string> = {declaration:'Деклариран запис',cash_count:'Преброени пари',cash_book:'Касов разчет',receipt:'Разписка / документ',bank_record:'Платежен запис'};
export const reasonLabels: Record<string, string> = { no_driver: 'Няма наличен шофьор', customer_requested: 'Отказ по желание на клиента', not_provided: 'Без посочена причина' };
export async function loadAccounting(month: string, scope: { companyId?: string; driverId?: string }, page = 0, signal?: AbortSignal): Promise<AccountingReport> {
 const { from, until } = monthBounds(month);
 const { data, error } = await withRequestTimeout(abort => supabase.rpc('accounting_report', { p_from: from, p_until: until, p_company_id: scope.companyId, p_driver_id: scope.driverId, p_page: page }).abortSignal(abort),10_000,signal);
 if (error) throw error;
 return parseAccountingReport(data, month, scope, page);
}
export async function exportAccounting(month: string, scope: { companyId?: string; driverId?: string }): Promise<AccountingReport> {
 const { from, until } = monthBounds(month);
 const { data, error } = await withRequestTimeout(abort => supabase.rpc('accounting_export', { p_from: from, p_until: until, p_company_id: scope.companyId, p_driver_id: scope.driverId }).abortSignal(abort), 20_000);
 if (error) throw new Error(error.code === '54000' ? 'Периодът съдържа над 10 000 записа. Експортът не е съкратен; нужен е по-кратък период.' : error.message);
 return parseAccountingReport(data, month, scope, 0, true);
}

// Reject malformed, stale-version or incorrectly scoped financial responses.
// A failed read must never silently become a zero balance.
const invalidReport = () => new Error('Финансовият отчет не може да бъде проверен. Обновете и опитайте отново.');
const object = (v: unknown): Record<string, unknown> => {
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalidReport();
 return v as Record<string, unknown>;
};
const amountValue = (v: unknown): number => {
 if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isSafeInteger(Math.round(v * 100)) || Number(v.toFixed(2)) !== v) throw invalidReport();
 return v;
};
const countValue = (v: unknown): number => {
 if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw invalidReport();
 return v;
};
const textValue = (v: unknown, nullable = false) => { if (!(typeof v === 'string' || nullable && v === null)) throw invalidReport(); };
const dateValue = (v: unknown, nullable = false) => { if (nullable && v === null) return; if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw invalidReport(); };
const cents = (v: number) => Math.round(v * 100);
export function parseAccountingReport(value: unknown, month: string, scope: { companyId?: string; driverId?: string }, page = 0, full = false): AccountingReport {
 const r = object(value), period = object(r.period), actualScope = object(r.scope), bounds = monthBounds(month);
 if (r.report_version !== 2 || r.currency !== 'EUR' || period.timezone !== 'Europe/Sofia' || period.from !== bounds.from || period.until !== bounds.until ||
  scope.companyId && actualScope.company_id !== scope.companyId || actualScope.driver_id !== (scope.driverId ?? null)) throw invalidReport();
 textValue(actualScope.company_id); dateValue(r.generated_at);
 const totals = object(r.totals), finances = object(r.finances), balance = object(r.balance);
 for (const key of ['completed','cancelled','interrupted','missing_amounts','unreported_completed']) countValue(totals[key]);
 if (amountValue(totals.booked) < 0) throw invalidReport();
 for (const key of ['income','expenses','handed_over','confirmed_handover','confirmed_income','net_income']) amountValue(finances[key]);
 for (const key of ['opening','movement','closing','unconfirmed_handover','unconfirmed_income']) amountValue(balance[key]);
 if (cents(balance.closing as number) !== cents(balance.opening as number) + cents(balance.movement as number) ||
  cents(finances.net_income as number) !== cents(finances.income as number) - cents(finances.expenses as number) ||
  cents(balance.movement as number) !== cents(finances.net_income as number) - cents(finances.handed_over as number)) throw invalidReport();
 for (const [name, counter, limit] of [['outcomes','outcome_count',full ? 10000 : 25],['entries','entry_count',full ? 10000 : 25],['drivers','driver_count',full ? 10000 : 50]] as const) {
  const count = countValue(r[counter]), rows = r[name];
  const offset = name === 'drivers' ? 0 : page * limit;
  if (!Array.isArray(rows) || full && count > limit || rows.length !== Math.min(limit, Math.max(0, count - offset))) throw invalidReport();
  if (new Set(rows.map(v => object(v)[name === 'drivers' ? 'driver_id' : 'id'])).size !== rows.length) throw invalidReport();
 }
 if ((totals.completed as number) + (totals.cancelled as number) !== r.outcome_count || (totals.unreported_completed as number) > (totals.completed as number)) throw invalidReport();
 for (const row of r.outcomes as unknown[]) {
  const o = object(row); for (const key of ['id','request_id','driver_name','previous_status']) textValue(o[key]);
  textValue(o.driver_id, true); dateValue(o.occurred_at); dateValue(o.accepted_at, true); dateValue(o.started_at, true);
  textValue(o.cancelled_by, true); textValue(o.cancel_reason, true);
  if (!['completed','cancelled'].includes(String(o.outcome)) || typeof o.reconstructed !== 'boolean' || o.outcome === 'cancelled' && o.booked_amount !== null) throw invalidReport();
  if (o.booked_amount !== null && amountValue(o.booked_amount) < 0) throw invalidReport();
  if (o.estimated_distance_km !== null && (typeof o.estimated_distance_km !== 'number' || !Number.isFinite(o.estimated_distance_km) || o.estimated_distance_km < 0)) throw invalidReport();
  if (o.evidence != null) {
   const e = object(o.evidence);
   for (const k of ['samples','good_samples','approach_meters','trip_meters','observed_seconds','stationary_seconds']) if (typeof e[k] !== 'number' || !Number.isFinite(e[k]) || (e[k] as number) < 0) throw invalidReport();
   if (!Array.isArray(e.flags) || e.flags.some(f => typeof f !== 'string')) throw invalidReport();
   dateValue(e.customer_confirmed_at, true);
  }
 }
 for (const row of r.entries as unknown[]) {
  const e = object(row);
  for (const key of ['id','driver_user_id','driver_name','note']) textValue(e[key]);
  for (const key of ['driver_id','actor_id','request_id','reference_id']) textValue(e[key], true);
  dateValue(e.recorded_at); for (const key of ['reference_recorded_at','reversed_at','confirmed_at']) dateValue(e[key], true);
  if (!Object.hasOwn(kindLabels, String(e.kind)) || amountValue(e.amount) <= 0 || typeof e.reversed !== 'boolean' || typeof e.confirmed !== 'boolean') throw invalidReport();
  const referenced = e.kind === 'reversal' || e.kind === 'confirmation';
  if (referenced ? !e.reference_id || !['income','expense','handover'].includes(String(e.reference_kind)) : e.reference_kind !== null || e.reference_id !== null) throw invalidReport();
  const signed = e.kind === 'confirmation' ? 0 : e.kind === 'reversal' ? -(e.amount as number) : e.amount;
  const effectiveKind = e.reference_kind ?? e.kind;
  if (amountValue(e.signed_amount) !== signed || amountValue(e.balance_delta) !== (effectiveKind === 'income' ? signed : -(signed as number))) throw invalidReport();
  if (!Object.hasOwn(evidenceLabels, String(e.evidence_source))) throw invalidReport();
  textValue(e.evidence_reference, true);
 }
 const outcomes = r.outcomes as Outcome[];
 if (!Array.isArray(r.reconciliation) || r.reconciliation.length !== outcomes.filter(o => o.outcome === 'completed').length) throw invalidReport();
 const recIds = new Set<string>();
 for (const row of r.reconciliation) {
  const rec = object(row);
  if (typeof rec.request_id !== 'string' || recIds.has(rec.request_id) || !outcomes.some(o => o.request_id === rec.request_id && o.outcome === 'completed') || typeof rec.company_confirmed !== 'boolean') throw invalidReport();
  recIds.add(rec.request_id); dateValue(rec.income_recorded_at, true);
  for (const key of ['estimated_amount','declared_income','difference']) if (rec[key] !== null) amountValue(rec[key]);
 }
 for (const row of r.drivers as unknown[]) {
  const d = object(row); textValue(d.driver_id, true); textValue(d.driver_name);
  countValue(d.trips); countValue(d.cancelled);
  for (const key of ['booked','income','expenses','handed_over','confirmed_income','confirmed_handover','closing']) amountValue(d[key]);
 }
 return r as unknown as AccountingReport;
}

// Text cells can execute formulas even when CSV-quoted. Known finite numeric
// values remain numbers, including legitimate negative correction amounts.
export function csvCell(value: unknown): string {
 const text = String(value ?? '');
 const prefix = typeof value !== 'number' && /^[\s]*[=+@-]/.test(text) ? "'" : '';
 return `"${prefix + text.replace(/"/g, '""')}"`;
}
export function reportCsv(outcomes: Outcome[], entries: MoneyEntry[], report?: AccountingReport): string {
 const rows: unknown[][] = [];
 if (report) {
  rows.push(['Отчет',report.period.from,report.period.until,'Крайна дата — без включване','EUR','Europe/Sofia'],
   ['Момент на извличане',report.generated_at],
   ['Начален остатък по записите',report.balance.opening],['Приходи (нето корекции)',report.finances.income],
   ['Разходи (нето корекции)',report.finances.expenses],['Предавания (нето корекции)',report.finances.handed_over],
   ['Сверени приходи през периода',report.finances.confirmed_income],['Сверени предавания през периода',report.finances.confirmed_handover],
   ['Краен остатък по записите',report.balance.closing],
   ['Остатъкът е изчислен по въведените записи. Не е доказана каса, данъчна печалба или дължима заплата.'],[]);
 }
 rows.push(['Вид', 'Шофьор', 'Дата (Europe/Sofia)', 'Заявка', 'Текущо състояние', 'Автор на отказа', 'Сума EUR (според вида)', 'Бележка', 'Идентификатор', 'Свързан запис', 'Източник на сверяване', 'Номер / референция', 'GPS наблюдения', 'Сигнали за преглед', 'Начало, потвърдено от клиент', 'Вид на свързания запис', 'Движение на остатъка EUR']);
 for (const o of outcomes) rows.push([o.outcome === 'completed' ? 'Завършен курс — стойност, не плащане' : 'Отменена заявка', o.driver_name || o.driver_id, new Date(o.occurred_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }), o.request_id, stageLabels[o.previous_status] || o.previous_status, actorLabels[o.cancelled_by ?? ''] ?? '', o.outcome === 'completed' ? o.booked_amount : '', `${reasonLabels[o.cancel_reason ?? ''] ?? o.cancel_reason ?? ''}${o.reconstructed ? ' (възстановен стар запис)' : ''}`, o.id, '', 'Записана цена на заявката', '', o.evidence ? evidenceDescription(o.evidence) : 'Няма наблюдения', o.evidence?.flags.map(f=>evidenceFlagLabels[f] ?? f).join(', ') ?? '', o.evidence?.customer_confirmed_at ?? '', '', 0]);
 for (const e of entries) rows.push([kindLabels[e.kind], e.driver_name || e.driver_id, new Date(e.recorded_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }), e.request_id, e.reversed ? 'С обратен запис' : e.confirmed ? 'Потвърдено' : 'Декларирано', '', e.kind === 'reversal' ? -e.amount : e.amount, e.note, e.id, e.reference_id, evidenceLabels[e.evidence_source ?? 'declaration'] ?? e.evidence_source, e.evidence_reference, '', '', '', e.reference_kind ? kindLabels[e.reference_kind] : '', e.balance_delta]);
 return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}
