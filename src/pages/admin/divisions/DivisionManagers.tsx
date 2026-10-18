import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import PartnerInvitations from '@/components/feature/PartnerInvitations';

export default function DivisionManagers({ company }: { company: string }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const latch = useRef(false);
  const query = useQuery({ queryKey: ['division-managers', user?.id, company], staleTime: 15_000, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('profiles').select('id,company_id,first_name,last_name,is_active,updated_at')
        .eq('company_id', company).eq('role', 'COMPANY_ADMIN').order('created_at').order('id').limit(101).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 100 || data.some(p => p.company_id !== company || typeof p.is_active !== 'boolean')) throw new Error('Управителите не са потвърдени.');
      return data;
    } });
  return <div className="space-y-5">
    <p className="text-sm text-foreground-600">Местният управител има достъп само до това подразделение. Основният фирмен акаунт запазва централния контрол.</p>
    {query.isPending ? <p role="status">Зареждаме управителите…</p> : query.isError ? <p role="alert">Списъкът не се зареди. <button className="underline" onClick={() => void query.refetch()}>Обнови</button></p> : <div className="space-y-2">{query.data.length === 0 && <p className="text-sm text-foreground-500">Все още няма местен управител.</p>}{query.data.map(manager => <div key={manager.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-background-200 p-3">
      <div><p className="text-sm font-semibold">{[manager.first_name, manager.last_name].filter(Boolean).join(' ') || 'Управител без попълнено име'}</p><p className="text-xs text-foreground-500">{manager.is_active ? 'Активен достъп' : 'Достъпът е спрян'}</p></div>
      <button type="button" disabled={busy} className="text-sm underline min-h-11 text-primary-700 disabled:opacity-50" onClick={async () => {
        if (latch.current) return; latch.current = true; setBusy(true); setError('');
        try {
          const { data, error } = await withRequestTimeout(signal => supabase.from('profiles').update({ is_active: !manager.is_active })
            .eq('id', manager.id).eq('company_id', company).eq('role', 'COMPANY_ADMIN').eq('updated_at', manager.updated_at)
            .select('id,company_id,is_active').abortSignal(signal).single(), 10_000);
          if (error || !data || data.id !== manager.id || data.company_id !== company || data.is_active === manager.is_active) throw new Error('Статусът не е потвърден. Обнови списъка преди нов опит.');
        } catch { setError('Промяната не е потвърдена. Провери текущия достъп в обновения списък.'); }
        finally { await query.refetch(); latch.current = false; setBusy(false); }
      }}>{manager.is_active ? 'Спри достъпа' : 'Възстанови достъпа'}</button>
    </div>)}</div>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="border-t border-background-200 pt-5"><h3 className="font-semibold mb-3">Покани управител</h3><PartnerInvitations kind="company" companyId={company} /></div>
  </div>;
}
