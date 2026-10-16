import { evidenceDescription, evidenceFlagLabels } from '@/lib/rideEvidence';
import { actorLabels, evidenceLabels, kindLabels, money, paymentMethodLabel, reasonLabels, reportDate, stageLabels, type AccountingReport, type MoneyEntry, type Outcome } from '@/lib/accounting';

export type MoneyAction = { entry: MoneyEntry; kind: 'confirmation' | 'reversal' };
const link = 'min-h-11 inline-flex items-center text-sm font-semibold text-primary-700 underline underline-offset-4 disabled:opacity-40';
const badge = 'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold';
const signedMoney = (amount: number) => `${amount > 0 ? '+' : ''}${money(amount)}`;
const names = { income: 'Получени пари', expense: 'Разход', handover: 'Предаване на фирмата', confirmation: 'Сверяване от фирмата', reversal: 'Корекция' };

export function AccountingOverview({ report, company, onTrips }: { report: AccountingReport; company: boolean; onTrips: () => void }) {
  const payment = report.payment_breakdown;
  return <>
    <div className="rounded-2xl border border-primary-200 bg-white overflow-hidden">
      <div className="p-5 sm:p-6 bg-primary-50/60">
        <h2 className="text-sm font-semibold text-foreground-700">{payment ? 'В брой по записите' : 'Остатък по въведените сметки'}</h2>
        <p className="mt-1 text-3xl sm:text-4xl font-bold font-heading tracking-tight tabular-nums text-foreground-950">{money(payment?.cash_closing ?? report.balance.closing)}</p>
        <p className="mt-2 text-xs text-foreground-500">{company ? 'За избрания екип или шофьор.' : 'По твоите записи.'} {payment ? 'Получени в брой − разходи в брой − предадени на фирмата. Картите са отделно. Изчислено по записите, не е преброена каса.' : 'Изчислен остатък, не преброена каса.'}</p>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-background-100">
        {[
          ...(payment ? [['В брой',payment.cash_income],['С карта',payment.card_income],['Разходи',report.finances.expenses]] : [['Получени пари',report.finances.income],['Разходи',report.finances.expenses],['Предадени',report.finances.handed_over]]),
        ].map(([title, value]) => <div key={title} className="min-w-0 p-3 sm:p-5">
          <dt className="text-[11px] sm:text-xs text-foreground-500">{title}</dt><dd className="mt-1 font-bold tabular-nums text-sm sm:text-xl break-words">{money(value as number)}</dd>
        </div>)}
      </dl>
    </div>
    {payment && <p className="text-xs text-foreground-600 px-1">Предадени в брой на фирмата: <strong>{money(payment.cash_handover)}</strong>. Картовите плащания са потвърдени от шофьора и подлежат на сверяване с терминала.</p>}
    {payment && (payment.unknown_income !== 0 || payment.unknown_expenses !== 0 || payment.unknown_handover !== 0 || payment.unknown_closing !== 0) && <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Има записи без посочен начин на плащане. Те са отделно от касата: получени {money(payment.unknown_income)}, разходи {money(payment.unknown_expenses)}, предадени {money(payment.unknown_handover)}. Провери историята преди сверяване.</p>}
    <button type="button" onClick={onTrips} className="w-full min-h-12 flex items-center justify-between gap-3 rounded-xl border border-background-200 bg-white px-4 py-3 text-left text-sm">
      <span><strong>{report.totals.completed}</strong> завършени курса <span className="text-foreground-400">·</span> стойност <strong className="tabular-nums">{money(report.totals.booked)}</strong></span>
      <span aria-hidden="true" className="text-primary-700">→</span>
    </button>
    <details className="rounded-xl border border-background-200 bg-white px-4 text-sm">
      <summary className="min-h-11 flex items-center cursor-pointer font-medium">Как се получават сумите</summary>
      <div className="pb-4 space-y-3 text-xs text-foreground-600">
        <p>При приключване на курс шофьорът потвърждава полученото плащане. То влиза автоматично тук и е свързано с курса. Неплатената част остава видима в „Курсове“. За стари и външни курсове може да се добави отделен запис.</p>
        <p>Начален остатък + приходи − разходи − предавания = краен остатък. Предаването не е разход, а сверяването не добавя парите повторно.</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {[
            ['Начален остатък', money(report.balance.opening)], ['Движение през месеца', signedMoney(report.balance.movement)],
            ['Приходи минус разходи', money(report.finances.net_income)], ['Сверени приходи през месеца, нето', money(report.finances.confirmed_income)],
            ['Сверени предавания през месеца, нето', money(report.finances.confirmed_handover)], ['Отменени заявки', String(report.totals.cancelled)],
            ['Прекратени след начало', String(report.totals.interrupted)],
          ].map(([title, value]) => <div key={title} className="flex justify-between gap-3"><dt>{title}</dt><dd className="font-semibold shrink-0 tabular-nums">{value}</dd></div>)}
        </dl>
        <p>Несверени към края на периода: приходи {money(report.balance.unconfirmed_income)} · предавания {money(report.balance.unconfirmed_handover)}.</p>
        <p>Корекциите и сверяванията се отчитат на датата на записване, включително за по-стар запис. Статусите в историята показват текущото състояние. Отрицателната сума може да е корекция.</p>
        <p>Това е оперативен отчет по въведени данни, не фискален документ, измерена касова наличност, данъчна печалба или дължима заплата.</p>
      </div>
    </details>
  </>;
}

export function AccountingMovements({ report, company, driver, userId, blocked, onAction, onReceipts }: {
  report: AccountingReport; company: boolean; driver: boolean; userId?: string; blocked: boolean; onAction: (action: MoneyAction) => void; onReceipts?: (entry: MoneyEntry) => void;
}) {
  return <div className="rounded-2xl border border-background-200 bg-white p-4 sm:p-5">
    <h2 className="font-semibold text-foreground-950">История на сметките</h2>
    <p className="text-xs text-foreground-500 mt-1 mb-2">Сумата вдясно е движението на остатъка. Сверяването не добавя пари.</p>
    {!report.entries.length && <p className="py-6 text-sm text-foreground-500">Няма въведени движения за този месец.</p>}
    <div className="divide-y divide-background-100">{report.entries.map(e => {
      const status = e.kind === 'reversal' ? 'Обратен запис' : e.kind === 'confirmation' ? 'Сверяване' : e.reversed ? 'Коригиран' : e.confirmed ? 'Сверен' : e.kind === 'expense' ? 'Записан' : 'За сверяване';
      const pending = status === 'За сверяване';
      const canDriverReverse = driver && !e.reversed && !e.confirmed && ['income', 'expense', 'handover'].includes(e.kind) && e.actor_id === userId;
      const companyEntry = company && ['income', 'handover'].includes(e.kind) && !e.reversed && e.actor_id !== userId;
      return <article key={e.id} className="py-4 space-y-2">
        <div className="flex justify-between items-start gap-3">
          <div className="min-w-0"><p className="text-sm font-semibold break-words">{names[e.kind]}</p>
            {company && <p className="mt-0.5 text-xs text-foreground-500 break-words">{e.driver_name || e.driver_id?.slice(0, 8) || 'Шофьор'}</p>}</div>
          <p className={`shrink-0 text-sm sm:text-base font-bold tabular-nums ${e.balance_delta > 0 ? 'text-emerald-700' : 'text-foreground-900'}`}>{signedMoney(e.balance_delta)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><span className={`${badge} ${pending ? 'bg-amber-50 text-amber-800' : e.confirmed || e.kind === 'confirmation' ? 'bg-emerald-50 text-emerald-800' : 'bg-background-100 text-foreground-600'}`}>{status}</span><span className="text-xs text-foreground-500">{reportDate(e.recorded_at)}</span></div>
        <p className="text-sm text-foreground-600 break-words">{e.note}</p>
        <p className="text-xs text-foreground-500">{paymentMethodLabel(e.effective_method ?? e.payment_method)}</p>
        {e.kind === 'confirmation' && <p className="text-xs text-foreground-500">Сверена сума: {money(e.amount)} · без ново движение на остатъка</p>}
        <div className="flex flex-wrap gap-x-5">
          {e.kind === 'expense' && onReceipts && <button className={link} onClick={()=>onReceipts(e)}>Документи към разхода</button>}
          {canDriverReverse && <button className={link} disabled={blocked} onClick={() => onAction({ entry: e, kind: 'reversal' })}>Коригирай</button>}
          {companyEntry && <button className={link} disabled={blocked} onClick={() => onAction({ entry: e, kind: e.confirmed ? 'reversal' : 'confirmation' })}>
            {e.confirmed ? 'Коригирай сверения запис' : e.kind === 'income' ? 'Свери приход' : 'Потвърди получаване'}
          </button>}
        </div>
        <details className="text-xs text-foreground-500">
          <summary className="min-h-8 inline-flex items-center cursor-pointer underline underline-offset-4">Детайли по записа</summary>
          <div className="mt-1 space-y-1 break-words">
            <p>Запис: {e.id}</p>
            {e.request_id && <p>Заявка: {e.request_id}</p>}
            {e.reference_kind && <p>Към: {kindLabels[e.reference_kind]} · {e.reference_id?.slice(0, 8)}{e.reference_recorded_at && ` · ${reportDate(e.reference_recorded_at)}`}</p>}
            {e.reversed_at && <p>Дата на корекцията: {reportDate(e.reversed_at)}</p>}
            {e.confirmed_at && <p>Дата на сверяването: {reportDate(e.confirmed_at)}</p>}
            {e.evidence_source !== 'declaration' && <p>Източник: {evidenceLabels[e.evidence_source ?? 'declaration'] ?? e.evidence_source}{e.evidence_reference && ` · ${e.evidence_reference}`}</p>}
          </div>
        </details>
      </article>;
    })}</div>
  </div>;
}

export function AccountingTrips({ report, company, driver, blocked, onPayment }: {
  report: AccountingReport; company: boolean; driver: boolean; blocked: boolean; onPayment: (trip: Outcome) => void;
}) {
  const reconciliation = new Map(report.reconciliation.map(r => [r.request_id, r]));
  return <div className="rounded-2xl border border-background-200 bg-white p-4 sm:p-5">
    <h2 className="font-semibold text-foreground-950">Курсове и откази</h2>
    {!report.outcomes.length && <p className="py-6 text-sm text-foreground-500">Няма приключени заявки за този месец.</p>}
    <div className="divide-y divide-background-100">{report.outcomes.map(o => {
      const payment = reconciliation.get(o.request_id);
      const unpaid = o.outcome === 'completed' && (payment?.declared_income == null || (payment.outstanding ?? 0) > 0);
      return <article key={o.id} className="py-4 space-y-2">
        <div className="flex justify-between gap-3"><p className="text-sm font-semibold">{o.outcome === 'completed' ? 'Завършен курс' : o.previous_status === 'in_progress' ? 'Прекратено пътуване' : 'Отменена заявка'}</p>
          <strong className="text-sm text-right tabular-nums">{o.outcome === 'completed' ? money(o.booked_amount) : 'Без начислен оборот'}</strong></div>
        <p className="text-xs text-foreground-500">{reportDate(o.occurred_at)}{company && ` · ${o.driver_name || 'Без назначен шофьор'}`}</p>
        {payment && <div className="space-y-1">
          <span className={`${badge} ${unpaid ? 'bg-amber-50 text-amber-800' : payment.company_confirmed ? 'bg-emerald-50 text-emerald-800' : 'bg-background-100 text-foreground-600'}`}>
            {unpaid ? payment.declared_income == null ? 'Без отчетено плащане' : 'Частично платен' : payment.company_confirmed ? 'Сверено плащане' : 'Отчетено · за сверяване'}
          </span>
          {payment.declared_income != null && <p className="text-xs text-foreground-600">{paymentMethodLabel(payment.payment_method)} · Получено: {money(payment.declared_income)} · Разлика спрямо заявката: {money(payment.difference)}</p>}
          {(payment.outstanding ?? 0)>0 && <p className="text-xs font-semibold text-amber-800">Остава за плащане: {money(payment.outstanding!)}</p>}
          {payment.payment_note && <p className="text-xs text-foreground-600 break-words">Причина при приключване: {payment.payment_note}</p>}
        </div>}
        {driver && unpaid && <button type="button" className={link} disabled={blocked} onClick={() => onPayment(o)}>{payment?.declared_income != null ? 'Отчети доплащане' : 'Отчети плащането'}</button>}
        <details className="text-xs text-foreground-500">
          <summary className="inline-flex items-center min-h-9 cursor-pointer underline underline-offset-4">Детайли за курса</summary>
          <div className="space-y-2 pt-1 break-words">
            <p>Заявка: {o.request_id}{o.reconstructed && ' · Възстановен стар запис'}</p>
            {o.outcome === 'cancelled' ? <p>{stageLabels[o.previous_status] || o.previous_status} · {actorLabels[o.cancelled_by ?? ''] || 'Неизвестен автор'} · {reasonLabels[o.cancel_reason ?? ''] || o.cancel_reason || 'Без причина'}</p>
              : o.estimated_distance_km != null && <p>Планиран маршрут: {Number(o.estimated_distance_km).toFixed(1)} км</p>}
            {o.outcome === 'cancelled' && o.accepted_at && <p>Време от приемането до отказа: {Math.max(0, Math.round((new Date(o.occurred_at).getTime() - new Date(o.accepted_at).getTime()) / 60000))} мин{!o.evidence && ' · Няма GPS наблюдения до отказа'}</p>}
            {o.evidence && <><p>{evidenceDescription(o.evidence)} · Наблюдаван престой: {(o.evidence.stationary_seconds / 60).toFixed(1)} мин</p>
              <p>{o.evidence.customer_confirmed_at ? 'Началото е потвърдено от клиента' : 'Няма потвърждение за начало от клиента'}</p>
              {!!o.evidence.flags.length && <p className="text-amber-700">За преглед: {o.evidence.flags.map(f => evidenceFlagLabels[f] ?? f).join(' · ')}</p>}
              <p>GPS данните може да са непълни; сигналите не доказват нарушение или плащане.</p></>}
          </div>
        </details>
      </article>;
    })}</div>
  </div>;
}

export function AccountingDrivers({ report, onChoose, onSearch }: { report: AccountingReport; onChoose: (id: string, name: string) => void; onSearch: () => void }) {
  return <div className="rounded-2xl border border-background-200 bg-white p-4 sm:p-5">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">По шофьор — избран месец</h2><button className={link} onClick={onSearch}>Намери шофьор</button></div>
    {!report.drivers.length && <p className="py-6 text-sm text-foreground-500">Няма движения по шофьор за този месец.</p>}
    <div className="divide-y divide-background-100">{report.drivers.map(d => <article key={d.driver_id ?? 'unassigned'} className="py-4 space-y-2">
      <div className="flex justify-between gap-3 text-sm font-semibold"><p className="break-words">{d.driver_name || 'Без назначен шофьор'}</p><p className="shrink-0 tabular-nums">{money(d.closing)}</p></div>
      <p className="text-xs text-foreground-500">{d.trips} завършени · {d.cancelled} отменени · стойност {money(d.booked)}</p>
      <p className="text-xs text-foreground-500">Получени: {money(d.income)} · Разходи: {money(d.expenses)} · Предадени: {money(d.handed_over)}</p>
      {d.driver_id && <button className={link} onClick={() => onChoose(d.driver_id!, d.driver_name || 'Шофьор')}>Отвори отчета</button>}
    </article>)}</div>
    {report.driver_count > report.drivers.length && <p className="mt-3 text-xs text-foreground-500">Показани са първите 50 групи. Намери конкретен шофьор с търсене или изтегли пълните записи в CSV.</p>}
  </div>;
}
