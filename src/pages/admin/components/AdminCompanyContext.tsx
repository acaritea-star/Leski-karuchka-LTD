import { createContext, useContext, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';

export interface CompanyOption { id: string; name: string }
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
        let request = supabase.from('companies').select('id, name');
        request = isSuperAdmin ? request.eq('is_active', true) : request.eq('id', user!.company_id!);
        return request.order('created_at', { ascending: false }).order('id').abortSignal(requestSignal);
      }, 10_000, signal);
      if (error) throw error;
      return data ?? [];
    },
  });
  // Identity belongs in the cache key; selection never starts another query.
  const companies = enabled ? query.data ?? [] : [];
  const selected = selection?.scope === scope && companies.find(company => company.id === selection.id);
  const company = selected || companies[0];
  const setCompanyId = (id: string) => {
    if (isSuperAdmin && companies.some(company => company.id === id)) setSelection({ scope, id });
  };
  return <AdminCompanyContext.Provider value={{
    companyId: company?.id ?? null, companies, companyName: company?.name ?? '', setCompanyId,
    loading: enabled && query.isPending,
    error: enabled && query.isError ? 'Фирмите не се заредиха. Провери връзката и опитай отново.' : null,
    reload: () => { void query.refetch(); },
  }}>{children}</AdminCompanyContext.Provider>;
}

export function useAdminCompany() { return useContext(AdminCompanyContext); }
