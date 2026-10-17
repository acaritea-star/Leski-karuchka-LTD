import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '@/components/feature/Modal';
import { useAuth } from '@/hooks/useAuth';
import { clearMoneyIntent, findMoneyOperation, prepareMoneyIntent, readMoneyIntent, writeMoneyOperation, type MoneyCommand } from '@/lib/pendingMoney';
import { isAmbiguousWrite } from '@/lib/rideOperations';
import { loadAccounting, exportAccounting, money, parseMoney, reportCsv, reportDate, sofiaMonth, type Outcome, type MoneyEntry } from '@/lib/accounting';
import { AccountingDrivers, AccountingMovements, AccountingOverview, AccountingTrips, type MoneyAction } from './AccountingViews';
import type { AccountingDriver } from './AccountingDriverPicker';

const ExpenseReceipts = lazy(() => import('./ExpenseReceipts'));
const DriverPicker = lazy(() => import('./AccountingDriverPicker'));
const inputClass = 'w-full min-h-11 rounded-xl border border-background-200 bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100';
const buttonClass = 'min-h-11 rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-600 disabled:opacity-50';
const secondaryButton = 'min-h-11 rounded-xl border border-background-200 bg-white px-3 py-2 text-sm font-medium hover:bg-background-50 disabled:opacity-40';
type View = 'movements' | 'trips' | 'drivers';
type EntryKind = 'income' | 'expense' | 'handover';
const entryNames: Record<EntryKind, string> = { income: 'Получени пари', expense: 'Разход', handover: 'Предаване на фирмата' };

function PendingOperation({ command, busy, onCheck, onRetry }: { command: MoneyCommand; busy: boolean; onCheck: () => void; onRetry: () => void }) {
  return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">
    <p className="text-sm font-semibold text-amber-900">Изчаква потвърждение</p>
    <p className="text-xs text-amber-900 break-words">{command.p_note} · {money(command.p_amount)}. Провери този запис, преди да добавиш нов.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} className={secondaryButton} onClick={onCheck}>Провери записа</button>
      <button type="button" disabled={busy} className={secondaryButton} onClick={onRetry}>Повтори същия запис</button>
    </div>
  </div>;
}

function AccountingWorkspace({ companyId, driverId }: { companyId?: string; driverId?: string }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const driverMode = !!driverId && !companyId;
  const [month, setMonth] = useState(sofiaMonth);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<View>('movements');
  const [selectedDriver, setSelectedDriver] = useState<AccountingDriver | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [kind, setKind] = useState<EntryKind>('income');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [method, setMethod] = useState<'cash'|'card'>('cash');
  const [receiptEntry, setReceiptEntry] = useState<Pick<MoneyEntry,'id'|'amount'|'note'|'reversed'> | null>(null);
  const [requestId, setRequestId] = useState('');
  const [action, setAction] = useState<MoneyAction | null>(null);
  const [actionNote, setActionNote] = useState('');
  const [evidenceSource, setEvidenceSource] = useState('cash_count');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState<MoneyCommand | null>(null);
  const inFlight = useRef(false);
  const exportInFlight = useRef(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const actionInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (entryOpen) amountInput.current?.focus({ preventScroll: true });
    else if (action) actionInput.current?.focus({ preventScroll: true });
  }, [entryOpen, action]);
  // A company filter changes the read scope, not ownership of a pending write.
  const scopeKey = `${companyId ?? ''}:${driverId ?? ''}`;
  const scope = { companyId, driverId: driverId ?? selectedDriver?.id };
  useEffect(() => {
    const saved = user?.id ? readMoneyIntent(user.id) : null;
    setPending(saved?.scope === scopeKey ? saved.command : null);
  }, [user?.id, scopeKey]);
  const query = useQuery({
    queryKey: ['accounting', user?.id, companyId, scope.driverId, month, page],
    queryFn: ({ signal }) => loadAccounting(month, scope, page, signal),
    enabled: !!user?.id && !!(companyId || driverId), staleTime: 30_000,
  });
  const report = query.data;
  const blocked = busy || !!pending || query.isError || !report;
  const dialogOpen = entryOpen || !!action;
  const resetDraft = () => { setAmount(''); setNote(''); setRequestId(''); setActionNote(''); };
  const complete = async (command: MoneyCommand, message: string) => {
    clearMoneyIntent(user!.id, command.p_id);
    if (command.p_kind === 'expense') setReceiptEntry({id:command.p_id,amount:command.p_amount,note:command.p_note,reversed:false});
    setPending(null); resetDraft(); setAction(null); setEntryOpen(false);
    setMonth(sofiaMonth()); setPage(0); setView('movements'); setSuccess(message);
    await client.invalidateQueries({ queryKey: ['accounting'] });
  };
  const write = async (payload: Omit<MoneyCommand, 'p_id'>) => {
    if (inFlight.current || !user?.id) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    let command: MoneyCommand | undefined;
    try {
      command = prepareMoneyIntent(user.id, scopeKey, payload); setPending(command);
      await writeMoneyOperation(command, user.id);
      await complete(command, 'Записът е запазен.');
    } catch (err) {
      if (command && !isAmbiguousWrite(err)) { clearMoneyIntent(user.id, command.p_id); setPending(null); }
      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : '';
      setError(message.includes('already recorded') ? 'За този курс вече има приход. Първо коригирай предишния запис.'
        : message.includes('already reversed') ? 'Записът вече е коригиран. Обнови отчета.'
        : message.includes('Confirmed entry') ? 'Записът е сверен от фирмата. Корекцията се прави от фирмен администратор.'
        : err instanceof Error ? err.message : 'Записът не е потвърден. Повтори със същите данни.');
    } finally { inFlight.current = false; setBusy(false); }
  };
  const retryPending = () => { if (pending) { const { p_id: _id, ...payload } = pending; void write(payload); } };
  const checkPending = async () => {
    if (!pending || !user || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (await findMoneyOperation(pending.p_id, user.id)) await complete(pending, 'Записът е потвърден.');
      else setError('Няма потвърждение за този запис. Повтори със същите данни.');
    } catch { setError('Проверката се забави. Записът остава за безопасно повторение.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const openEntry = (nextKind: EntryKind, trip?: Outcome) => {
    if (blocked) return;
    const due = trip && report?.reconciliation.find(r => r.request_id === trip.request_id)?.outstanding;
    setKind(nextKind); setMethod('cash'); setAmount((due ?? trip?.booked_amount)?.toFixed(2) ?? '');
    setNote(trip ? `Плащане по курс ${trip.request_id.slice(0, 8)}` : '');
    setRequestId(trip?.request_id ?? ''); setError(''); setSuccess(''); setAction(null); setEntryOpen(true);
  };
  const openAction = (next: MoneyAction) => {
    if (blocked) return;
    setAction(next); setActionNote(''); setEvidenceSource((next.entry.effective_method ?? next.entry.payment_method) === 'card' ? 'bank_record' : 'cash_count'); setEvidenceReference('');
    setError(''); setSuccess(''); setEntryOpen(false);
  };
  const closeDialog = () => {
    if (busy) return;
    setEntryOpen(false); setAction(null); setError('');
    if (!pending) resetDraft();
  };
  const submitEntry = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    try {
      if (!note.trim()) throw new Error('Добави описание на сумата.');
      void write({ p_kind: kind, p_amount: parseMoney(amount), p_note: note.trim(), p_payment_method: kind === 'handover' ? 'cash' : method, p_request_id: kind === 'income' && requestId ? requestId : undefined });
    } catch (err) { setError(err instanceof Error ? err.message : 'Провери сумата.'); }
  };
  const exportCsv = async () => {
    if (!report || exportInFlight.current) return;
    exportInFlight.current = true; setExporting(true); setError('');
    try {
      const snapshot = await exportAccounting(month, scope);
      const url = URL.createObjectURL(new Blob([reportCsv(snapshot.outcomes, snapshot.entries, snapshot)], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url;
      a.download = `leski-report-${month}${companyId ? `-company-${companyId.slice(0, 8)}` : ''}${companyId && scope.driverId ? `-driver-${scope.driverId.slice(0, 8)}` : ''}.csv`;
      document.body.append(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Експортът не успя. Опитай отново.'); }
    finally { exportInFlight.current = false; setExporting(false); }
  };
  const changeView = (next: View) => { setView(next); setPage(0); };
  const chooseDriver = (driver: AccountingDriver | null) => { setSelectedDriver(driver); setPage(0); setView('movements'); setPickerOpen(false); setError(''); };
  const maxPages = Math.max(1, Math.ceil((view === 'trips' ? report?.outcome_count ?? 0 : report?.entry_count ?? 0) / 25));
  const pendingPanel = pending && <PendingOperation command={pending} busy={busy} onCheck={() => void checkPending()} onRetry={retryPending} />;
  const verifiedAction = !!action && (action.kind === 'confirmation' || !!companyId && action.entry.confirmed);
  const actionTitle = action?.kind === 'confirmation' ? action.entry.kind === 'income' ? 'Потвърдете сверения приход' : 'Потвърдете действително получените пари' : 'Корекция на запис';

  return <section className="max-w-5xl mx-auto space-y-4" aria-label="Отчет и сметки">
    <div className="flex flex-wrap items-end gap-2 sm:gap-3">
      <label className="min-w-0 flex-1 sm:flex-none text-xs font-medium text-foreground-600">Месец на отчета
        <input aria-label="Месец на отчета" type="month" value={month} disabled={busy || exporting}
          onChange={e => { if (e.target.value) { setMonth(e.target.value); setPage(0); setError(''); setSuccess(''); } }} className={`${inputClass} mt-1`} />
      </label>
      {companyId && <button type="button" className={secondaryButton} disabled={busy || exporting} onClick={() => setPickerOpen(true)}>Избери шофьор</button>}
      <button type="button" className={secondaryButton} disabled={!report || exporting || busy || query.isError} onClick={() => void exportCsv()}>{exporting ? 'Изтегляне…' : 'Изтегли CSV'}</button>
      <button type="button" className={secondaryButton} disabled={query.isFetching || busy} onClick={() => void query.refetch()}>Обнови</button>
    </div>
    {companyId && selectedDriver && <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50 px-4 py-2 text-sm">
      <p className="min-w-0 break-words">Отчет за <strong>{selectedDriver.name}</strong></p>
      <button type="button" disabled={busy || exporting} onClick={() => chooseDriver(null)} className="min-h-11 shrink-0 font-medium text-primary-700 underline">Всички шофьори</button>
    </div>}
    {!dialogOpen && pendingPanel}
    {(query.isError || error && !dialogOpen) && <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{error || 'Отчетът не се зареди. Показаните по-рано суми не са обновени.'}</p>
      {query.isError && <button type="button" disabled={query.isFetching} className="min-h-11 underline" onClick={() => void query.refetch()}>Опитай отново</button>}
    </div>}
    {success && <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{success}</p>}
    {query.isPending && <p role="status" className="py-8 text-sm text-foreground-500">Зареждане на отчета…</p>}
    {report && <>
      <AccountingOverview report={report} company={!!companyId} onTrips={() => changeView('trips')} />
      {driverMode && <p className="text-xs text-foreground-500">Плащанията по курсовете се добавят при приключването им. Тук можеш да добавиш разход, външен приход или предаване на пари.</p>}
      {driverMode && <div className="grid grid-cols-3 gap-2" aria-label="Нов финансов запис">
        {(['income', 'expense', 'handover'] as const).map(value => <button key={value} type="button" disabled={blocked} onClick={() => openEntry(value)}
          className={`min-w-0 min-h-14 rounded-xl px-2 text-xs sm:text-sm font-semibold whitespace-nowrap disabled:opacity-40 ${value === 'income' ? 'bg-primary-500 text-white hover:bg-primary-600' : 'border border-background-200 bg-white hover:bg-background-50'}`}>{value === 'income' ? '+ Получени' : value === 'expense' ? '− Разход' : 'Предаване'}</button>)}
      </div>}
      {!!(report.totals.unreported_completed + (report.totals.partially_paid ?? 0)) && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 text-sm text-amber-900">
        <p><strong>{report.totals.unreported_completed + (report.totals.partially_paid ?? 0)}</strong> завършени курса с непълно плащане</p>
        <button type="button" className="min-h-11 font-semibold underline" onClick={() => changeView('trips')}>Виж курсовете</button>
      </div>}
      {!!report.totals.missing_amounts && <p className="text-sm text-amber-800">{report.totals.missing_amounts} завършени курса са без записана крайна сума и не участват в сбора.</p>}
      <nav aria-label="Раздели на отчета" className="flex gap-1 rounded-xl border border-background-200 bg-white p-1">
        {([
          ['movements', 'Движения'], ['trips', 'Курсове'], ...(companyId ? [['drivers', 'Шофьори']] : []),
        ] as [View, string][]).map(([value, title]) => <button key={value} type="button" aria-pressed={view === value} disabled={busy}
          onClick={() => changeView(value)} className={`flex-1 min-h-11 rounded-lg px-2 text-sm font-semibold ${view === value ? 'bg-primary-50 text-primary-800' : 'text-foreground-500 hover:bg-background-50'}`}>{title}</button>)}
      </nav>
      {view === 'movements' && <AccountingMovements report={report} company={!!companyId} driver={driverMode} userId={user?.id} blocked={blocked} onAction={openAction} onReceipts={setReceiptEntry} />}
      {view === 'trips' && <AccountingTrips report={report} company={!!companyId} driver={driverMode} blocked={blocked} onPayment={trip => openEntry('income', trip)} />}
      {view === 'drivers' && companyId && <AccountingDrivers report={report} onChoose={(id, name) => chooseDriver({ id, name })} onSearch={() => setPickerOpen(true)} />}
      {view !== 'drivers' && maxPages > 1 && <div className="flex items-center justify-between gap-3 text-sm" aria-label="Страници на отчета">
        <button disabled={!page || query.isFetching || busy} className={secondaryButton} onClick={() => setPage(p => p - 1)}>Назад</button>
        <span className="text-foreground-500">Страница {page + 1} от {maxPages}</span>
        <button disabled={page + 1 >= maxPages || query.isFetching || busy} className={secondaryButton} onClick={() => setPage(p => p + 1)}>Напред</button>
      </div>}
      <p className="text-[11px] text-foreground-400">Българско време · Справка от {reportDate(report.generated_at)}</p>
    </>}

    {entryOpen && driverMode && <Modal label={entryNames[kind]} onClose={closeDialog} busy={busy} className="max-w-lg">
      <form onSubmit={submitEntry} className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-foreground-500">Нов финансов запис</p><h2 className="text-xl font-bold">{entryNames[kind]}</h2></div>
          <button type="button" aria-label="Затвори новия запис" onClick={closeDialog} className="min-w-11 min-h-11 rounded-xl hover:bg-background-100">×</button></div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <fieldset disabled={busy || !!pending} className="space-y-4 min-w-0">
          <label className="block text-sm font-medium">Сума в евро<input ref={amountInput} className={`${inputClass} mt-1 text-xl tabular-nums`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" required /></label>
          {kind === 'income' && <><p className="text-xs text-foreground-500">Въведи действително получената сума. Цената на заявката е само ориентир за този запис.</p>
            <label className="block text-xs text-foreground-600">Връзка с курс от показаната страница<select aria-label="Връзка с курс от показаната страница" className={`${inputClass} mt-1`} value={requestId} onChange={e => setRequestId(e.target.value)}>
              <option value="">Без връзка с курс / външен приход</option>
              {report?.outcomes.filter(o => o.outcome === 'completed').map(o => <option key={o.id} value={o.request_id}>{reportDate(o.occurred_at)} — {money(o.booked_amount)} — {o.request_id.slice(0, 8)}</option>)}
            </select></label></>}
          {kind !== 'handover' && <fieldset className="space-y-2"><legend className="text-sm font-medium">Начин на плащане</legend><div className="grid grid-cols-2 gap-2">{(['cash','card'] as const).map(value=><button key={value} type="button" aria-pressed={method===value} onClick={()=>setMethod(value)} className={`${secondaryButton} ${method===value?'border-primary-500 bg-primary-50 text-primary-800':''}`}>{value==='cash'?'В брой':'С карта'}</button>)}</div></fieldset>}
          {kind === 'expense' && <div className="flex flex-wrap gap-2" aria-label="Бързо описание на разхода">{['Гориво', 'Паркинг', 'Поддръжка'].map(value => <button key={value} type="button" className="min-h-9 rounded-full border border-background-200 px-3 text-xs" onClick={() => setNote(value)}>{value}</button>)}</div>}
          <label className="block text-sm font-medium">Описание<input className={`${inputClass} mt-1`} value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder={kind === 'income' ? 'Например: получено плащане по курс' : kind === 'expense' ? 'Например: гориво' : 'Например: предаване на каса'} required /></label>
          <p className="text-xs text-foreground-500">Записва се с днешна дата и е видим за твоята фирма. Предаването на пари изисква отделно потвърждение от фирмата.</p>
          {!pending && <div className="flex flex-wrap gap-2"><button className={`${buttonClass} flex-1`} disabled={busy}>{busy ? 'Запазване…' : 'Добави запис'}</button><button type="button" className={secondaryButton} onClick={closeDialog}>Откажи</button></div>}
        </fieldset>
        {pendingPanel}
      </form>
    </Modal>}
    {action && <Modal label={actionTitle} onClose={closeDialog} busy={busy} className="max-w-lg">
      <form className="p-5 space-y-4" onSubmit={e => {
        e.preventDefault();
        if (!pending && actionNote.trim()) void write({ p_kind: action.kind, p_amount: action.entry.amount, p_note: actionNote.trim(), p_reference_id: action.entry.id, p_payment_method: action.entry.effective_method ?? action.entry.payment_method ?? null,
          ...(verifiedAction ? { p_source: evidenceSource, p_evidence_ref: evidenceReference.trim() || undefined } : {}) });
      }}>
        <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold">{actionTitle}</h2><button type="button" aria-label="Затвори действието" className="min-w-11 min-h-11 rounded-xl hover:bg-background-100" onClick={closeDialog}>×</button></div>
        <div className="rounded-xl bg-background-50 p-4"><p className="text-2xl font-bold tabular-nums">{money(action.entry.amount)}</p><p className="text-sm mt-1 break-words">{action.entry.note}</p><p className="mt-1 text-xs text-foreground-500">{action.entry.driver_name} · {reportDate(action.entry.recorded_at)}</p></div>
        <p className="text-xs text-foreground-500">{action.kind === 'confirmation' ? 'Потвърждаваш сверяването, без да добавяш сумата повторно.' : 'Оригиналът остава в историята. Добавя се обратен запис с днешна дата.'}</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <fieldset disabled={busy || !!pending} className="space-y-4 min-w-0">
          <label className="block text-sm font-medium">Основание<input ref={actionInput} className={`${inputClass} mt-1`} required value={actionNote} onChange={e => setActionNote(e.target.value)} maxLength={500} /></label>
          {verifiedAction && <>
            <label className="block text-sm font-medium">Източник<select aria-label="Източник" className={`${inputClass} mt-1`} value={evidenceSource} onChange={e => setEvidenceSource(e.target.value)}>
              {(action.entry.effective_method ?? action.entry.payment_method) !== 'card' && <><option value="cash_count">Преброени пари</option><option value="cash_book">Касов разчет</option></>}<option value="receipt">Разписка / документ</option><option value="bank_record">Платежен запис</option>
            </select></label>
            {(action.entry.effective_method ?? action.entry.payment_method) === 'card' && <p className="text-xs text-foreground-500">Свери картовото плащане с платежен запис или документ от терминала. Преброеният кеш не доказва плащане с карта.</p>}
            <label className="block text-sm font-medium">Номер / референция<input className={`${inputClass} mt-1`} maxLength={160} required={evidenceSource !== 'cash_count'} value={evidenceReference} onChange={e => setEvidenceReference(e.target.value)} /></label>
          </>}
          {!pending && <div className="flex flex-wrap gap-2"><button className={`${buttonClass} flex-1`} disabled={busy}>Потвърди</button><button type="button" className={secondaryButton} onClick={closeDialog}>Откажи</button></div>}
        </fieldset>
        {pendingPanel}
      </form>
    </Modal>}
    {receiptEntry && user?.id && <Suspense fallback={<p role="status">Зареждане на документите…</p>}><ExpenseReceipts key={`${user.id}:${receiptEntry.id}`} entry={receiptEntry} owner={user.id} canUpload={driverMode} onClose={()=>setReceiptEntry(null)} /></Suspense>}
    {pickerOpen && companyId && <Suspense fallback={<p role="status" className="text-sm text-foreground-500">Зареждане на избора…</p>}><DriverPicker companyId={companyId} onChoose={chooseDriver} onClose={() => setPickerOpen(false)} /></Suspense>}
  </section>;
}

export default function AccountingPanel(props: { companyId?: string; driverId?: string }) {
  const { user } = useAuth();
  return <AccountingWorkspace key={`${user?.id ?? ''}:${props.companyId ?? ''}:${props.driverId ?? ''}`} {...props} />;
}
