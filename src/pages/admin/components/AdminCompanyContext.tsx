import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';

export interface CompanyOption { id: string; name: string; is_active?: boolean }
interface AdminCompanyCtx {
  companyId: string | null;
  companies: CompanyOption[];
  companyName: string;
  setCompanyId: (id: string) => void;
  loading: boolean;
  error: string | null;
  reload: () => void;
}
const AdminCompanyContext = createContext<AdminCompanyCtx>({
  companyId: null, companies: [], companyName: '', setCompanyId: () => {},
  loading: true, error: null, reload: () => {},
});

function readSelection(scope: string): string | null {
  try { return sessionStorage.getItem('leski:admin-company:' + scope); } catch { return null; }
}
function saveSelection(scope: string, id: string): void {
  try { sessionStorage.setItem('leski:admin-company:' + scope, id); } catch { /* In-memory selection still works. */ }
}

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const enabled = isSuperAdmin || (user?.role === 'COMPANY_ADMIN' && !!user.company_id);
  const scope = JSON.stringify([user?.id, user?.role, user?.company_id]);
  const [selection, setSelection] = useState<{ scope: string; id: string } | null>(null);
  const query = useQuery({
    queryKey: ['admin-companies', user?.id, user?.role, user?.company_id],
    enabled, staleTime: 60_000, retry: 1,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(requestSignal => {
        let request = supabase.from('companies').select('id, name, is_active');
        if (!isSuperAdmin) request = request.eq('id', user!.company_id!);
        return request.order('created_at', { ascending: false }).order('id').abortSignal(requestSignal);
      }, 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
  });
  // A saved choice is only presentation state; validate it against this account's
  // query result. A company administrator can never switch to a foreign tenant.
  const companies = enabled ? (query.data ?? []).filter(company => isSuperAdmin || company.id === user?.company_id) : [];
  const preferredId = isSuperAdmin ? (selection?.scope === scope ? selection.id : readSelection(scope)) : user?.company_id;
  const selected = companies.find(company => company.id === preferredId);
  const company = selected || companies[0];
  const selectedId = company?.id;
  useEffect(() => {
    if (!isSuperAdmin || !selectedId) return;
    // Pin even the initial choice: adding another company must not change it.
    setSelection(previous => previous?.scope === scope && previous.id === selectedId ? previous : { scope, id: selectedId });
    saveSelection(scope, selectedId);
  }, [scope, isSuperAdmin, selectedId]);
  const setCompanyId = (id: string) => {
    if (isSuperAdmin && companies.some(company => company.id === id)) {
      setSelection({ scope, id });
      saveSelection(scope, id);
    }
  };
  return <AdminCompanyContext.Provider value={{
    companyId: company?.id ?? null, companies, companyName: company?.name ?? '', setCompanyId,
    loading: enabled && query.isPending,
    error: enabled && query.isError ? 'Фирмите не се заредиха. Провери връзката и опитай отново.' : null,
    reload: () => { void query.refetch(); },
  }}>{children}</AdminCompanyContext.Provider>;
}

export function useAdminCompany() { return useContext(AdminCompanyContext); }
