import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { workflowError } from '@/lib/driverDocuments';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

const fields = [
  ['name', 'Име за клиентите', 'text'], ['legal_name', 'Юридическо наименование', 'text'], ['registration_id', 'ЕИК', 'text'],
  ['phone', 'Телефон', 'tel'], ['address', 'Фирмен адрес', 'text'], ['service_city', 'Основен град на обслужване', 'text'],
  ['permit_number', 'Удостоверение / разрешение за таксиметров превоз', 'text'], ['permit_expires_on', 'Валидно до', 'date'],
  ['base_fare', 'Начална такса (EUR)', 'number'], ['min_fare', 'Минимална цена (EUR)', 'number'], ['price_per_km', 'Цена на км (EUR)', 'number'],
  ['price_per_minute', 'Цена на минута от маршрута (EUR)', 'number'], ['dispatch_radius_km', 'Радиус за заявки (км)', 'number'],
] as const;
function readDraft(key: string): Record<string, string> { try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; } }
export default function CompanySetup() {
  const { user } = useAuth(), client = useQueryClient(), navigate = useNavigate();
  const { companies, setCompanyId, loading: companiesLoading } = useAdminCompany();
  const { logout, pending } = useSignOut();
  const [search] = useSearchParams();
  const requestedId = search.get('company') ?? user?.company_id;
  const companyId = companies.some(company => company.id === requestedId) ? requestedId : null;
  const explicitCompany = search.has('company');
  const draftKey = `leski:company-setup:${user?.id}:${companyId}`;
  const [draft, setDraft] = useState(() => ({ key: draftKey, values: readDraft(draftKey) }));
  const values = draft.key === draftKey ? draft.values : readDraft(draftKey);
  useEffect(() => { setDraft(old => old.key === draftKey ? old : { key: draftKey, values: readDraft(draftKey) }); }, [draftKey]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const latch = useRef(false);
  const query = useQuery({ queryKey: ['company-setup', user?.id, companyId], enabled: !!companyId, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('companies').select('*').eq('id', companyId!).abortSignal(abort).single(), 10_000, signal);
      if (error) throw error; return data;
    },
  });
  useEffect(() => { if (query.data?.setup_completed_at) { setCompanyId(query.data.id); navigate('/admin/dashboard', { replace: true }); } }, [query.data, navigate, setCompanyId]);
  useEffect(() => {
    if (!explicitCompany && query.data?.id === user?.company_id && query.data?.parent_company_id === null && companies.some(company => company.parent_company_id === query.data!.id)) navigate('/admin/divisions', { replace: true });
  }, [explicitCompany, query.data, user?.company_id, companies, navigate]);
  function change(name: string, value: string) {
    setDraft(old => { const next = { ...(old.key === draftKey ? old.values : readDraft(draftKey)), [name]: value }; try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* The form remains usable without storage. */ } return { key: draftKey, values: next }; });
  }
  return <main className="brand-scope min-h-[100dvh] bg-background-50 p-4 sm:p-8"><div className="max-w-2xl mx-auto space-y-5">
    <div className="flex items-center justify-between"><Link to="/" className="font-heading font-semibold">Лески Каручка</Link><button onClick={logout} disabled={pending} className="text-xs underline">Изход</button></div>
    <section className="bg-white border border-background-200 rounded-2xl p-5 space-y-4"><h1 className="font-heading text-xl font-semibold">Настрой твоята фирма</h1>
      <p className="text-sm text-foreground-600">Фирменият ти достъп е потвърден. Попълни реалните данни и тарифи; след това добави автомобилите и шофьорите от фирмения панел.</p>
      {(user?.role === 'SUPER_ADMIN' || companies.some(company => company.id === user?.company_id && company.parent_company_id === null)) && <div className="bg-primary-50 rounded-xl p-4 space-y-2"><p className="text-sm font-semibold">Ще работиш в няколко града?</p><p className="text-sm text-foreground-600">Създай отделно подразделение за всеки град и въведи неговите разрешения и тарифи.</p><Link to="/admin/divisions" className="inline-flex items-center min-h-11 text-sm text-primary-700 font-semibold underline">Отвори подразделенията</Link></div>}
      {companiesLoading ? <p role="status">Проверяваме фирмения достъп…</p> : !companyId ? <p role="alert">Фирменият достъп не е свързан. <Link to="/company" className="underline">Провери поканата</Link></p> : query.isPending ? <p role="status">Зареждаме твоята фирма…</p> : query.isError ? <p role="alert">Фирмата не се зареди. <button onClick={() => void query.refetch()} className="underline">Опитай отново</button></p> : <form aria-label="Първоначална фирмена настройка" className="space-y-4" onSubmit={async e => {
        e.preventDefault(); if (latch.current) return; latch.current = true; setBusy(true); setError('');
        const f = new FormData(e.currentTarget); const payload = Object.fromEntries(fields.map(([name, , type]) => [name, type === 'number' ? Number(f.get(name)) : String(f.get(name) ?? '').trim()]));
        try {
          const { data, error } = await withRequestTimeout(signal => supabase.rpc('complete_company_setup', { p_company: companyId, p_data: payload }).abortSignal(signal), 12_000);
          if (error) throw error;
          if (!data || typeof data !== 'object' || Array.isArray(data) || !data.setup_completed_at || data.id !== companyId) throw new Error('Настройката не е потвърдена. Обнови статуса.');
          try { localStorage.removeItem(draftKey); } catch { /* Completion is persisted on the server. */ }
          await client.invalidateQueries({ queryKey: ['admin-companies'] }); await client.invalidateQueries({ queryKey: ['partner-entry', user?.id] });
          setCompanyId(companyId!); navigate('/admin/dashboard', { replace: true });
        } catch (e) { setError(workflowError(e, 'Записът не е потвърден. Обнови статуса преди повторен опит.')); }
        finally { latch.current = false; setBusy(false); }
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">{fields.map(([name, label, type]) => {
          const stored = query.data?.[name];
          const hasStoredTariff = typeof query.data?.price_per_km === 'number' && Number.isFinite(query.data.price_per_km) && query.data.price_per_km > 0;
          const fallback = name === 'dispatch_radius_km' ? String(stored ?? 5) : type === 'number'
            ? hasStoredTariff && typeof stored === 'number' && Number.isFinite(stored) && stored >= 0 ? String(stored) : ''
            : name === 'name' && stored === 'Нова фирма' ? '' : String(stored ?? '');
          return <label key={name} className="block text-sm">{label}<input required name={name} type={type} value={values[name] ?? fallback} disabled={busy} onChange={e => change(name, e.target.value)}
            min={type === 'number' ? name === 'price_per_km' ? 0.01 : name === 'dispatch_radius_km' ? 0.5 : 0 : undefined} max={name === 'dispatch_radius_km' ? 30 : undefined} step={type === 'number' ? '0.01' : undefined} pattern={name === 'registration_id' ? '([0-9]{9}|[0-9]{13})' : undefined}
            maxLength={name === 'registration_id' ? 13 : 300} className="block w-full mt-1 rounded-xl border border-background-200 p-3" /></label>;
        })}</div>
        <p className="text-xs text-foreground-500">Основният град описва фирмата. Заявките се ограничават от реалното местоположение на шофьора, радиуса и действащите проверки за България.</p>
        <p className="text-xs text-foreground-500">Таксата за обслужване към Лески Каручка е 8–12% според договорените обем и капацитет. Подробности: <Link to="/company-partner" className="underline">условия за партньори</Link>. Настройката не замества проверката на разрешенията и документите.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error} <button type="button" onClick={() => void query.refetch()} className="underline">Провери статуса</button></p>}
        <button disabled={busy} className="w-full rounded-xl bg-primary-500 text-white p-3 disabled:opacity-60">{busy ? 'Запазваме фирмата…' : 'Запази фирмата и отвори панела'}</button>
      </form>}
    </section>
  </div></main>;
}
