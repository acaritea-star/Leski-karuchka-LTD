import { evidenceDescription, evidenceFlagLabels } from '@/lib/rideEvidence';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { clearMoneyIntent, findMoneyOperation, prepareMoneyIntent, readMoneyIntent, writeMoneyOperation, type MoneyCommand } from '@/lib/pendingMoney';
import { isAmbiguousWrite } from '@/lib/rideOperations';
import { actorLabels, evidenceLabels, kindLabels, loadAccounting, money, parseMoney, reasonLabels, reportCsv, reportDate, sofiaMonth, stageLabels, type MoneyEntry } from '@/lib/accounting';

type Command = MoneyCommand;
const inputClass = 'w-full rounded-lg border border-background-200 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
export default function AccountingPanel({ companyId, driverId }: { companyId?: string; driverId?: string }) {
 const { user } = useAuth();
 const client = useQueryClient();
 const [month, setMonth] = useState(sofiaMonth);
 const [page, setPage] = useState(0);
 const [kind, setKind] = useState('income');
 const [amount, setAmount] = useState('');
 const [note, setNote] = useState('');
 const [requestId, setRequestId] = useState('');
 const [action, setAction] = useState<{ entry: MoneyEntry; kind: 'confirmation' | 'reversal' } | null>(null);
 const [actionNote, setActionNote] = useState('');
 const [evidenceSource, setEvidenceSource] = useState('cash_count');
 const [evidenceReference, setEvidenceReference] = useState('');
 const [busy, setBusy] = useState(false);
 const [exporting, setExporting] = useState(false);
 const [error, setError] = useState('');
 const [success, setSuccess] = useState('');
 const [pending, setPending] = useState<Command | null>(null);
 const inFlight = useRef(false);
 const scope = { companyId, driverId };
 const scopeKey = `${companyId ?? ''}:${driverId ?? ''}`;
 useEffect(() => { const saved = user?.id ? readMoneyIntent(user.id) : null; setPending(saved?.scope === scopeKey ? saved.command : null); }, [user?.id, scopeKey]);
 const query = useQuery({
  queryKey: ['accounting', user?.id, companyId, driverId, month, page],
  queryFn: ({ signal }) => loadAccounting(month, scope, page, signal),
  enabled: !!user?.id && !!(companyId || driverId), staleTime: 30000,
 });
 const report = query.data;
 const write = async (payload: Omit<Command, 'p_id'>) => {
  if (inFlight.current || !user?.id) return;
  inFlight.current = true; setBusy(true); setError(''); setSuccess('');
  let command: Command | undefined;
  try {
   command = prepareMoneyIntent(user.id, scopeKey, payload); setPending(command);
   await writeMoneyOperation(command, user.id);
   clearMoneyIntent(user.id, command.p_id); setPending(null); setAmount(''); setNote(''); setRequestId(''); setAction(null); setActionNote('');
   setSuccess('Записът е запазен.');
   await client.invalidateQueries({ queryKey: ['accounting'] });
  } catch (err) {
   if (command && !isAmbiguousWrite(err)) { clearMoneyIntent(user.id, command.p_id); setPending(null); }
   const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
   setError(message.includes('already recorded') ? 'За този курс вече има приход. Първо коригирайте предишния запис.' : message.includes('already reversed') ? 'Записът вече е коригиран. Обновете отчета.' : message.includes('Confirmed handover') ? 'Получаването вече е потвърдено и не може да бъде отменено от шофьора.' : err instanceof Error ? err.message : 'Записът не е потвърден. Повторете със същите данни.');
  } finally { inFlight.current = false; setBusy(false); }
 };
 const checkPending = async () => {
  if (!pending || !user || busy) return;
  setBusy(true); setError('');
  try { if (await findMoneyOperation(pending.p_id,user.id)) { clearMoneyIntent(user.id,pending.p_id);setPending(null);setSuccess('Записът е потвърден.');await query.refetch(); }
   else setError('Няма потвърждение за този запис. Повторете със същите данни.');
  } catch { setError('Проверката се забави. Записът остава за безопасно повторение.'); }
  finally { setBusy(false); }
 };
 const submit = (event: React.FormEvent) => {
  event.preventDefault();
  try {
   if (!note.trim()) throw new Error('Добавете описание на сумата.');
   void write({ p_kind: kind, p_amount: parseMoney(amount), p_note: note.trim(), p_request_id: kind === 'income' && requestId ? requestId : undefined });
  } catch (err) { setError(err instanceof Error ? err.message : 'Проверете сумата.'); }
 };
 const exportCsv = async () => {
  if (!report || exporting) return;
  setExporting(true); setError('');
  try {
   const first = await loadAccounting(month, scope);
   const pages = Math.ceil(Math.max(first.outcome_count, first.entry_count) / 25);
   if (pages > 400) throw new Error('Периодът съдържа над 10 000 записа. За този обем е нужен отделен сървърен експорт.');
   const outcomes = [...first.outcomes], entries = [...first.entries];
   for (let i = 1; i < pages; i++) {
    const next = await loadAccounting(month, scope, i);
    if (next.outcome_count !== first.outcome_count || next.entry_count !== first.entry_count) throw new Error('Отчетът се промени по време на експорта. Опитайте отново.');
    outcomes.push(...next.outcomes); entries.push(...next.entries);
   }
   if (new Set(outcomes.map(o => o.id)).size !== first.outcome_count || new Set(entries.map(e => e.id)).size !== first.entry_count) throw new Error('Отчетът се промени по време на експорта. Опитайте отново.');
   const url = URL.createObjectURL(new Blob([reportCsv(outcomes, entries)], { type: 'text/csv;charset=utf-8' }));
   const a = document.createElement('a'); a.href = url; a.download = `leski-report-${month}.csv`; a.click(); URL.revokeObjectURL(url);
  } catch (err) { setError(err instanceof Error ? err.message : 'Експортът не успя. Опитайте отново.'); }
  finally { setExporting(false); }
 };
 const maxPages = Math.max(1, Math.ceil(Math.max(report?.outcome_count ?? 0, report?.entry_count ?? 0) / 25));
 return <section className="space-y-4" aria-label="Отчет и сметки">
  <div className="flex flex-wrap items-end gap-3">
   <label className="text-xs text-foreground-500">Месец (българско време)<input aria-label="Месец на отчета" type="month" value={month} disabled={busy || exporting} onChange={e => { if (e.target.value) { setMonth(e.target.value); setPage(0); setAction(null); setError(''); } }} className={`${inputClass} mt-1`} /></label>
   <button className={buttonClass} disabled={!report || exporting} onClick={() => void exportCsv()}>{exporting ? 'Изтегляне…' : 'Изтегли CSV'}</button>
   <button className="text-sm text-primary-600 underline" disabled={query.isFetching} onClick={() => void query.refetch()}>Обнови</button>
  </div>
  <p className="text-xs text-foreground-500">Стойността на курсовете е записаната при поръчване цена. Тя не е доказателство за получени пари. Приходите и разходите са декларирани; фирмата потвърждава сверяването на приходите и получаването на предадени пари. Отчетът не е фискален документ.</p>
  {pending && <div className="bg-background-50 rounded-xl p-3 text-xs space-y-2"><p>Непотвърден запис: {pending.p_note} · {money(pending.p_amount)}</p><div className="flex gap-3"><button disabled={busy} className="underline text-primary-600" onClick={()=>void checkPending()}>Провери записа</button><button disabled={busy} className="underline text-primary-600" onClick={()=>{ const {p_id: _id,...payload}=pending;void write(payload); }}>Повтори същия запис</button></div></div>}
  {(error || query.isError) && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error || 'Отчетът не се зареди. Опитайте отново.'}</p>}
  {success && <p role="status" className="text-sm text-primary-600">{success}</p>}
  {query.isPending && <p role="status" className="text-sm text-foreground-500">Зареждане на отчета…</p>}
  {report && <>
   <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
    {[
     ['Записана стойност на курсовете', money(report.totals.booked)],
     ['Завършени курсове', String(report.totals.completed)],
     ['Отменени заявки', String(report.totals.cancelled)],
     ['Прекратени след начало', String(report.totals.interrupted)],
     ['Декларирани приходи', money(report.finances.income)],
     ['Приходи, сверени от фирмата', money(report.finances.confirmed_income ?? 0)],
     ['Декларирани разходи', money(report.finances.expenses)],
     ['Приходи минус разходи', money(report.finances.income - report.finances.expenses)],
     ['Предаване: декларирано / потвърдено', `${money(report.finances.handed_over)} / ${money(report.finances.confirmed_handover)}`],
    ].map(([label, value]) => <div key={label} className="bg-white rounded-xl border border-background-100 p-4"><p className="text-lg font-bold text-foreground-950 font-heading">{value}</p><p className="mt-1 text-xs text-foreground-500">{label}</p></div>)}
   </div>
   <p className="text-xs text-foreground-500">Приходите минус разходите са лична сметка по въведените данни, преди данъци и неотчетени задължения. Предаването не е разход. Потвържденията се отнасят към месеца на първоначалния финансов запис.</p>
   {!!report.totals.missing_amounts && <p className="text-sm text-amber-700">{report.totals.missing_amounts} завършени курса са без записана крайна сума и не участват в сбора.</p>}
   {driverId && <form onSubmit={submit} className="bg-white rounded-xl border border-background-100 p-4 space-y-3">
    <h2 className="font-semibold text-foreground-950">Моите сметки</h2>
    <p className="text-xs text-foreground-500">Записът е с текуща дата и е видим за вашата фирма. За външен курс изберете „Без връзка с курс“. Получените пари не се добавят автоматично от стойността на заявката.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
     <label className="text-xs text-foreground-500">Вид<select className={inputClass} value={kind} disabled={busy} onChange={e => { setKind(e.target.value); setRequestId(''); }}><option value="income">Получени пари — декларирани</option><option value="expense">Разход — деклариран</option><option value="handover">Предадени пари на фирмата</option></select></label>
     <label className="text-xs text-foreground-500">Сума в евро<input className={inputClass} inputMode="decimal" value={amount} disabled={busy} onChange={e => setAmount(e.target.value)} placeholder="0,00" required /></label>
    </div>
    {kind === 'income' && <label className="block text-xs text-foreground-500">Връзка с курс от показаната страница<select className={inputClass} value={requestId} disabled={busy} onChange={e => setRequestId(e.target.value)}><option value="">Без връзка с курс / външен приход</option>{report.outcomes.filter(o => o.outcome === 'completed').map(o => <option key={o.id} value={o.request_id}>{reportDate(o.occurred_at)} — {money(o.booked_amount)} — {o.request_id.slice(0, 8)}</option>)}</select></label>}
    <label className="block text-xs text-foreground-500">Описание<input className={inputClass} value={note} disabled={busy} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Например: гориво, външен курс, предаване на каса" required /></label>
    <button className={buttonClass} disabled={busy}>{busy ? 'Запазване…' : 'Добави запис'}</button>
   </form>}
   {action && <form className="bg-white rounded-xl border border-background-100 p-4 space-y-3" onSubmit={e => { e.preventDefault(); if (actionNote.trim()) void write({ p_kind: action.kind, p_amount: action.entry.amount, p_note: actionNote.trim(), p_reference_id: action.entry.id, ...(action.kind === 'confirmation' ? {p_source:evidenceSource,p_evidence_ref:evidenceReference.trim() || undefined} : {}) }); }}>
    <h3 className="font-semibold">{action.kind === 'confirmation' ? action.entry.kind === 'income' ? 'Потвърдете сверения приход' : 'Потвърдете действително получените пари' : 'Коригирайте с обратен запис'} — {money(action.entry.amount)}</h3>
    <label className="block text-xs text-foreground-500">Основание<input className={inputClass} required value={actionNote} onChange={e => setActionNote(e.target.value)} maxLength={500} disabled={busy} /></label>
    {action.kind === 'confirmation' && <><label className="block text-xs text-foreground-500">Източник<select className={inputClass} value={evidenceSource} onChange={e=>setEvidenceSource(e.target.value)} disabled={busy}><option value="cash_count">Преброени пари</option><option value="cash_book">Касов разчет</option><option value="receipt">Разписка / документ</option><option value="bank_record">Платежен запис</option></select></label><label className="block text-xs text-foreground-500">Номер / референция<input className={inputClass} maxLength={160} required={evidenceSource !== 'cash_count'} value={evidenceReference} onChange={e=>setEvidenceReference(e.target.value)} disabled={busy}/></label></>}
    <div className="flex gap-3"><button className={buttonClass} disabled={busy}>Потвърди</button><button type="button" disabled={busy} className="text-sm text-foreground-500" onClick={() => setAction(null)}>Откажи</button></div>
   </form>}
   <div className="bg-white rounded-xl border border-background-100 p-4 space-y-3">
    <h2 className="font-semibold text-foreground-950">Курсове и откази</h2>
    {!report.outcomes.length && <p className="text-sm text-foreground-400">Няма приключени заявки за тази страница и период.</p>}
    {report.outcomes.map(o => <article key={o.id} className="border-b border-background-100 py-3 last:border-0">
     <div className="flex justify-between gap-3"><p className="text-sm font-medium">{o.outcome === 'completed' ? 'Завършен курс' : o.previous_status === 'in_progress' ? 'Прекратено пътуване' : 'Отменена заявка'}{companyId && ` · ${o.driver_name || 'Без назначен шофьор'}`}</p><strong className="text-sm">{o.outcome === 'completed' ? money(o.booked_amount) : 'Без начислен оборот'}</strong></div>
     <p className="text-xs text-foreground-500 mt-1">{reportDate(o.occurred_at)} · Заявка {o.request_id.slice(0, 8)}{o.reconstructed && ' · Възстановен стар запис'}</p>
     {report.reconciliation?.filter(r=>r.request_id===o.request_id).map(r=><p key={r.request_id} className="text-xs text-foreground-500 mt-1">Деклариран приход: {money(r.declared_income)}{r.declared_income!=null&&<> · {r.company_confirmed?'Сверен от фирмата':'Очаква сверяване'} · Разлика спрямо заявката: {money(r.difference)}</>}</p>)}
     {o.outcome === 'cancelled' && o.accepted_at && <p className="text-xs text-foreground-500 mt-1">Време от приемането до отказа: {Math.max(0, Math.round((new Date(o.occurred_at).getTime() - new Date(o.accepted_at).getTime()) / 60000))} мин{!o.evidence && ' · Няма GPS наблюдения до отказа'}</p>}
     {o.evidence && <div className="text-xs text-foreground-500 mt-1 space-y-1">
      <p>{evidenceDescription(o.evidence)} · Наблюдаван престой: {(o.evidence.stationary_seconds/60).toFixed(1)} мин</p>
      <p>{o.evidence.customer_confirmed_at ? 'Началото е потвърдено от клиента' : 'Няма потвърждение за начало от клиента'}</p>
      {!!o.evidence.flags.length && <p className="text-amber-700">За преглед: {o.evidence.flags.map(f=>evidenceFlagLabels[f] ?? f).join(' · ')}</p>}
      <p>GPS данните може да са непълни; сигналите не доказват нарушение или плащане.</p>
     </div>}
     {o.outcome === 'cancelled' ? <p className="text-xs text-foreground-500 mt-1">{stageLabels[o.previous_status] || o.previous_status} · {actorLabels[o.cancelled_by ?? ''] || 'Неизвестен автор'} · {reasonLabels[o.cancel_reason ?? ''] || o.cancel_reason || 'Без причина'}</p> : o.estimated_distance_km != null && <p className="text-xs text-foreground-500 mt-1">Планиран маршрут: {Number(o.estimated_distance_km).toFixed(1)} км</p>}
    </article>)}
   </div>
   <div className="bg-white rounded-xl border border-background-100 p-4 space-y-3">
    <h2 className="font-semibold text-foreground-950">История на сметките</h2>
    {!report.entries.length && <p className="text-sm text-foreground-400">Няма въведени суми за тази страница и период.</p>}
    {report.entries.map(e => <article key={e.id} className="border-b border-background-100 py-3 last:border-0">
     <div className="flex justify-between gap-3"><p className="text-sm font-medium">{kindLabels[e.kind]}{companyId && ` · ${e.driver_name || e.driver_id?.slice(0, 8) || 'Шофьор'}`}</p><strong className="text-sm">{money(e.amount)}</strong></div>
     <p className="text-xs text-foreground-500 mt-1">{reportDate(e.recorded_at)} · {e.note}{e.reversed ? ' · Коригиран с обратен запис' : e.confirmed ? e.kind === 'income' ? ' · Приходът е сверен от фирмата' : ' · Получаването е потвърдено' : ''}</p>
     {e.kind === 'confirmation' && <p className="text-xs text-foreground-500">Източник: {evidenceLabels[e.evidence_source ?? 'declaration'] ?? e.evidence_source}{e.evidence_reference && ` · ${e.evidence_reference}`}</p>}
     {e.request_id && <p className="text-xs text-foreground-400">Заявка {e.request_id.slice(0, 8)}</p>}
     {!e.reversed && !e.confirmed && ['income','expense','handover'].includes(e.kind) && driverId && e.actor_id === user?.id && <button className="mt-2 text-xs text-primary-600 underline" disabled={busy} onClick={() => { setAction({ entry: e, kind: 'reversal' }); setActionNote(''); }}>Коригирай</button>}
     {companyId && ['handover','income'].includes(e.kind) && !e.reversed && !e.confirmed && e.actor_id !== user?.id && <button className="mt-2 text-xs text-primary-600 underline" disabled={busy} onClick={() => { setAction({ entry: e, kind: 'confirmation' }); setActionNote('');setEvidenceSource('cash_count');setEvidenceReference(''); }}>{e.kind === 'income' ? 'Свери приход' : 'Потвърди получаване'}</button>}
    </article>)}
   </div>
   {companyId && report.drivers.length > 0 && <div className="bg-white rounded-xl border border-background-100 p-4"><h2 className="font-semibold mb-3">По шофьор — избран месец</h2>{report.drivers.map(d => <p key={d.driver_id ?? 'unassigned'} className="text-sm py-2 border-b border-background-100">{d.driver_name || 'Без назначен шофьор'} · {d.trips} завършени · {d.cancelled} отменени · {money(d.booked)}</p>)}{report.drivers.length === 50 && <p className="text-xs text-foreground-500">Показани са първите 50 групи. Пълните записи са в CSV.</p>}</div>}
   <div className="flex items-center justify-between text-sm"><button disabled={page === 0 || query.isFetching} className="text-primary-600 disabled:opacity-40" onClick={() => setPage(p => p - 1)}>Назад</button><span>Страница {page + 1} от {maxPages}</span><button disabled={page + 1 >= maxPages || query.isFetching} className="text-primary-600 disabled:opacity-40" onClick={() => setPage(p => p + 1)}>Напред</button></div>
  </>}
 </section>;
}
