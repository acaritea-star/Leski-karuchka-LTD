import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import Modal from '@/components/feature/Modal';
import { loadCompanyDivisions, setDivisionActive, type CompanyDivision } from '@/lib/companyDivisions';
import { workflowError } from '@/lib/driverDocuments';
import DivisionEditor from './DivisionEditor';
import DivisionGroupReport from './DivisionGroupReport';
import DivisionManagers from './DivisionManagers';

export default function AdminDivisions() {
  const { user } = useAuth(); const context = useAdminCompany();
  const selected = context.companies.find(company => company.id === context.companyId);
  const parent = context.companies.find(company => company.id === (selected?.parent_company_id ?? selected?.id));
  const allowed = !!parent && parent.parent_company_id == null && (user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN' && user.company_id === parent.id);
  return <AdminLayout title="Градове и подразделения">{context.loading ? <p role="status">Проверяваме достъпа…</p> : !allowed || !parent ? <div className="rounded-2xl border border-background-200 bg-white p-6"><h2 className="font-semibold">Нужен е централен фирмен достъп</h2><p className="mt-2 text-sm text-foreground-600">Градските подразделения се създават и управляват от основния фирмен акаунт. Местният управител използва менюто на своето подразделение.</p></div> : <DivisionWorkspace key={`${user!.id}:${parent.id}`} parent={parent} />}</AdminLayout>;
}

function DivisionWorkspace({ parent }: { parent: { id: string; name: string } }) {
  const { user } = useAuth(), { setCompanyId } = useAdminCompany(), client = useQueryClient(), navigate = useNavigate();
  const key = ['company-divisions', user?.id, parent.id];
  const [tab, setTab] = useState<'divisions' | 'report'>('divisions');
  const [editing, setEditing] = useState<CompanyDivision | 'new' | null>(null), [managers, setManagers] = useState<CompanyDivision | null>(null);
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''); const latch = useRef(false);
  const query = useQuery({ queryKey: key, staleTime: 30_000, retry: 1, queryFn: ({ signal }) => loadCompanyDivisions(parent.id, signal) });
  async function refresh() {
    await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ['admin-companies', user?.id] }), client.invalidateQueries({ queryKey: ['division-report', user?.id, parent.id] })]);
  }
  function open(division: CompanyDivision, path: string) { setCompanyId(division.id); navigate(path); }
  return <div className="space-y-5">
    <section className="rounded-2xl border border-background-200 bg-white p-5 flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="text-xs font-semibold text-primary-700">ЦЕНТРАЛНО УПРАВЛЕНИЕ</p><h2 className="font-heading text-xl font-semibold mt-1 break-words">{parent.name}</h2><p className="text-sm text-foreground-500 mt-2">Отделни тарифи, екипи и отчети за всеки град. Избирай подразделение от горното меню, за да работиш в него.</p></div><button type="button" onClick={() => { setError(''); setNotice(''); setEditing('new'); }} className="min-h-12 px-4 rounded-xl bg-primary-500 text-white text-sm font-semibold shrink-0">Добави подразделение</button></section>
    <div role="tablist" aria-label="Управление на подразделения" className="flex flex-wrap gap-2">{([['divisions', 'Подразделения'], ['report', 'Общ отчет']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`min-h-11 px-4 rounded-xl text-sm font-semibold ${tab === value ? 'bg-foreground-950 text-white' : 'bg-white border border-background-200 text-foreground-600'}`}>{label}</button>)}</div>
    {error && <p role="alert" className="rounded-xl bg-red-50 text-red-700 p-4 text-sm">{error}</p>}{notice && <p role="status" className="rounded-xl bg-primary-50 text-primary-700 p-4 text-sm">{notice}</p>}
    {tab === 'report' ? <DivisionGroupReport parent={parent.id} /> : <section aria-label="Подразделения" className="space-y-4">
      <div className="flex justify-between items-center gap-3"><p className="text-sm text-foreground-500">{query.data ? `${query.data.length} подразделения` : 'Градове на фирмата'}</p><button type="button" disabled={query.isFetching || !!busy} onClick={() => void refresh()} className="min-h-11 px-3 text-sm underline">Обнови списъка</button></div>
      {query.isPending ? <p role="status" className="py-12 text-center text-foreground-500">Зареждаме подразделенията…</p> : query.isError ? <p role="alert" className="rounded-xl bg-red-50 text-red-700 p-4">Подразделенията не се заредиха. Обнови списъка.</p> : query.data.length === 0 ? <div className="rounded-2xl border border-background-200 bg-white p-8 text-center"><i className="ri-building-4-line text-3xl text-primary-600" aria-hidden="true" /><h3 className="font-semibold mt-3">Добави първия си град</h3><p className="text-sm text-foreground-500 mt-2">Създай подразделение, довърши данните му и въведи неговите тарифи.</p></div> : <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{query.data.map(division => <article key={division.id} className="rounded-2xl border border-background-200 bg-white p-5 space-y-4">
        <div><div className="flex items-start justify-between gap-3"><h3 className="font-semibold break-words">{division.name}</h3><span className={`text-xs px-2 py-1 rounded-full shrink-0 ${!division.setup_completed_at ? 'bg-amber-50 text-amber-800' : division.is_active ? 'bg-primary-50 text-primary-700' : 'bg-background-100 text-foreground-600'}`}>{!division.setup_completed_at ? 'Подготовка' : division.is_active ? 'Активно' : 'Спряно'}</span></div><p className="text-sm text-foreground-500 mt-2">{division.service_city} · зона {division.service_radius_km} км</p></div>
        {(division.setup_completed_at || division.price_per_km > 0) && <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-foreground-500">Километър денем</dt><dd className="text-lg font-semibold mt-1">{division.price_per_km.toFixed(2)} €</dd></div><div><dt className="text-xs text-foreground-500">Километър нощем</dt><dd className="text-lg font-semibold mt-1">{(division.night_price_per_km ?? division.price_per_km).toFixed(2)} €</dd></div></dl>}
        {!division.setup_completed_at && <p className="text-sm text-foreground-500">{division.price_per_km > 0 ? 'Цените са подготвени. Довърши фирмените данни и разрешенията преди работа.' : 'Очаква реални разрешения и тарифи.'}</p>}
        <button type="button" onClick={() => open(division, division.setup_completed_at ? '/admin/dashboard' : '/company/setup?company=' + division.id)} className="w-full min-h-11 rounded-xl bg-primary-50 text-primary-700 text-sm font-semibold">{division.setup_completed_at ? 'Управлявай подразделението' : 'Довърши настройката'}</button>
        <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => { setNotice(''); setEditing(division); }} className="min-h-11 rounded-xl border border-background-200 text-sm">Име и зона</button>{division.setup_completed_at && <button type="button" onClick={() => open(division, '/admin/pricing')} className="min-h-11 rounded-xl border border-background-200 text-sm">Цени</button>}</div>
        {division.setup_completed_at && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-background-100 pt-3"><button type="button" onClick={() => setManagers(division)} className="min-h-11 text-sm underline text-primary-700">Местни управители</button><button type="button" disabled={!!busy} className="min-h-11 text-sm underline disabled:opacity-50" onClick={async () => {
          if (latch.current) return; latch.current = true; setBusy(division.id); setError(''); setNotice('');
          try { const saved = await setDivisionActive(division, !division.is_active); setNotice(saved.is_active ? `${division.name}: активирано.` : `${division.name}: новите заявки са спрени. Започнатите курсове могат да приключат.`); }
          catch (error) { setError(workflowError(error, 'Промяната не е потвърдена. Обнови списъка.')); }
          finally { await refresh(); latch.current = false; setBusy(null); }
        }}>{busy === division.id ? 'Проверяваме…' : division.is_active ? 'Спри новите заявки' : 'Активирай'}</button></div>}
      </article>)}</div>}
    </section>}
    {editing && <DivisionEditor key={editing === 'new' ? 'new' : editing.id} parent={parent} previous={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onRefresh={() => void refresh()} onSaved={row => { setEditing(null); setNotice(row.setup_completed_at ? 'Подразделението е запазено.' : 'Подразделението е създадено в подготовка. Довърши настройката преди работа.'); void refresh(); }} />}
    {managers && <Modal label={`Управители на ${managers.name}`} onClose={() => setManagers(null)} className="max-w-xl"><div className="p-5 space-y-5"><div className="flex justify-between items-start gap-3"><h2 className="font-heading font-semibold">Управители · {managers.name}</h2><button type="button" aria-label="Затвори" onClick={() => setManagers(null)} className="min-w-11 min-h-11 rounded-xl hover:bg-background-50">×</button></div><DivisionManagers key={managers.id} company={managers.id} /></div></Modal>}
  </div>;
}
