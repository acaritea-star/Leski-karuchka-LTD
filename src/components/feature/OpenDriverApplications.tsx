import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loadOpenDriverCompanies, openDriverAccess, type PartnerAccess } from '@/lib/partnerAccess';
import { workflowError } from '@/lib/driverDocuments';

export default function OpenDriverApplications({ onChoose }: { onChoose: (access: PartnerAccess) => void }) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const latch = useRef(false);
  const query = useQuery({ queryKey: ['open-driver-companies'], queryFn: ({ signal }) => loadOpenDriverCompanies(signal),
    staleTime: 30_000, retry: 1, refetchOnWindowFocus: false });
  return <section aria-label="Кандидатстване без покана" className="border-t border-background-200 pt-5 space-y-4 text-left">
    <h2 className="text-lg font-semibold">Искаш да започнеш работа?</h2>
    <p className="text-sm text-foreground-600">Тези фирми приемат кандидатури без лична покана. Тарифите се определят от фирмата. Започваш работа след обучение, проверка на документите и одобрение.</p>
    {query.isPending && <p role="status" className="text-sm">Проверяваме отворените кандидатури…</p>}
    {query.isError && <div role="alert" className="text-sm text-red-700">Кандидатурите не се заредиха. <button onClick={() => void query.refetch()} className="underline min-h-11">Опитай отново</button></div>}
    {query.data?.length === 0 && <p className="text-sm text-foreground-500">В момента няма фирми с отворено кандидатстване. Можеш да поискаш лична покана от твоята фирма.</p>}
    {query.data?.map(company => <div key={company.id} className="rounded-xl border border-background-200 bg-white p-4 space-y-3">
      <div><h3 className="font-semibold break-words">{company.name}</h3>{company.service_city && <p className="text-sm text-foreground-500">{company.service_city}</p>}</div>
      <p className="text-sm text-foreground-600">Базова тарифа: начална такса {company.base_fare.toFixed(2)} € · {company.price_per_km.toFixed(2)} €/км · {company.price_per_minute.toFixed(2)} €/мин · минимум {company.min_fare.toFixed(2)} €</p>
      <button disabled={busy !== null} className="w-full min-h-11 rounded-xl bg-primary-500 px-4 py-3 font-semibold text-white disabled:opacity-60" onClick={async () => {
        if (latch.current) return;
        latch.current = true; setBusy(company.id); setError('');
        try { onChoose(await openDriverAccess(company.id)); }
        catch (e) { setError(workflowError(e, 'Кандидатстването не е потвърдено. Провери отново.')); void query.refetch(); }
        finally { latch.current = false; setBusy(null); }
      }}>{busy === company.id ? 'Проверяваме…' : 'Кандидатствай към ' + company.name}</button>
    </div>)}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
