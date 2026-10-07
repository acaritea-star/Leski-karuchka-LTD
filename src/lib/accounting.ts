import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export interface Outcome {
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
 evidence_source?: string; evidence_reference?: string | null;
}
export interface AccountingReport {
 totals: { completed: number; cancelled: number; interrupted: number; booked: number; missing_amounts: number };
 finances: { income: number; expenses: number; handed_over: number; confirmed_handover: number; confirmed_income?: number };
 outcome_count: number; entry_count: number; outcomes: Outcome[]; entries: MoneyEntry[];
 reconciliation?: { request_id:string; estimated_amount:number|null; declared_income:number|null; income_recorded_at:string|null; company_confirmed:boolean; difference:number|null }[];
 drivers: { driver_id: string | null; driver_name: string; trips: number; cancelled: number; booked: number }[];
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
 return data as unknown as AccountingReport;
}
// Spreadsheet apps can execute formula-like cells even when CSV-quoted.
export function csvCell(value: unknown): string {
 const text = String(value ?? '');
 return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
}
export function reportCsv(outcomes: Outcome[], entries: MoneyEntry[]): string {
 const rows: unknown[][] = [['Вид', 'Шофьор', 'Дата (Europe/Sofia)', 'Заявка', 'Етап/състояние', 'Автор на отказа', 'Сума EUR', 'Бележка', 'Идентификатор', 'Свързан запис', 'Източник на сверяване', 'Номер / референция']];
 for (const o of outcomes) rows.push([o.outcome === 'completed' ? 'Завършен курс' : 'Отменена заявка', o.driver_name || o.driver_id, new Date(o.occurred_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }), o.request_id, stageLabels[o.previous_status] || o.previous_status, actorLabels[o.cancelled_by ?? ''] ?? '', o.outcome === 'completed' ? o.booked_amount : '', `${reasonLabels[o.cancel_reason ?? ''] ?? o.cancel_reason ?? ''}${o.reconstructed ? ' (възстановен стар запис)' : ''}`, o.id, '', 'Прогнозна стойност', '']);
 for (const e of entries) rows.push([kindLabels[e.kind], e.driver_name || e.driver_id, new Date(e.recorded_at).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' }), e.request_id, e.reversed ? 'С обратен запис' : e.confirmed ? 'Потвърдено' : 'Декларирано', '', e.amount, e.note, e.id, e.reference_id, evidenceLabels[e.evidence_source ?? 'declaration'] ?? e.evidence_source, e.evidence_reference]);
 return '\uFEFF' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
}
