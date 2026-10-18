import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { sofiaMonth, money } from '@/lib/accounting';
import { loadDivisionReport } from '@/lib/companyDivisions';

export default function DivisionGroupReport({ parent }: { parent: string }) {
  const { user } = useAuth();
  const [month, setMonth] = useState(() => sofiaMonth());
  const query = useQuery({ queryKey: ['division-report', user?.id, parent, month], enabled: /^\d{4}-(0[1-9]|1[0-2])$/.test(month), staleTime: 30_000, retry: 1,
    queryFn: ({ signal }) => loadDivisionReport(parent, month, signal) });
  return <section className="space-y-5" aria-label="Общ отчет по подразделения">
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-medium">Месец<input type="month" required value={month} onChange={e => setMonth(e.target.value)} className="block mt-1 min-h-11 rounded-xl border border-background-200 p-2" /></label><button disabled={query.isFetching} onClick={() => void query.refetch()} className="min-h-11 px-4 rounded-xl border border-background-200 text-sm">Обнови отчета</button></div>
    {!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? <p role="alert">Избери валиден месец.</p> : query.isPending ? <p role="status" className="py-12 text-center text-foreground-500">Зареждаме отчетите…</p> : query.isError ? <div role="alert" className="bg-red-50 text-red-700 p-4 rounded-xl">Общият отчет не е потвърден. Провери връзката и обнови отчета.</div> : query.data && <>
      <div className="grid sm:grid-cols-3 gap-3">{([['Отчетени приходи', query.data.total.income], ['Отчетени разходи', query.data.total.expenses], ['Наличност в брой при шофьорите', query.data.total.cash_closing]] as const).map(([label, value]) => <div key={label} className="rounded-2xl border border-background-200 bg-white p-4"><p className="text-sm text-foreground-500">{label}</p><p className="text-2xl font-heading font-semibold mt-2">{money(value)}</p></div>)}</div>
      <p className="text-sm text-foreground-600">{query.data.total.completed} приключени курса · {query.data.total.cancelled} отказани. Общият отчет събира отделните оперативни отчети. Предадените пари не се броят като нов приход.</p>
      <div className="grid md:grid-cols-2 gap-4">{query.data.companies.map(company => <article key={company.id} className="rounded-2xl border border-background-200 bg-white p-5 space-y-4">
        <div><h3 className="font-semibold break-words">{company.name}</h3><p className="text-xs text-foreground-500 mt-1">{company.parent_company_id === null ? 'Основна фирма — собствени операции' : company.service_city} · {company.summary.completed} курса</p></div>
        <dl className="grid grid-cols-2 gap-3 text-sm">{([['Приходи', company.summary.income], ['Разходи', company.summary.expenses], ['Приети в брой', company.summary.cash_income], ['Приети с карта', company.summary.card_income], ['Неуточнено плащане', company.summary.unknown_income], ['Предадени на фирмата', company.summary.handed_over]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-foreground-500">{label}</dt><dd className="font-semibold mt-1">{money(value)}</dd></div>)}</dl>
      </article>)}</div>
      <p className="text-xs text-foreground-500">Периодът е по българско време. Приходите и плащанията с карта не означават автоматично банково потвърждение. Корекциите следват датата на финансовия запис.</p>
    </>}
  </section>;
}
