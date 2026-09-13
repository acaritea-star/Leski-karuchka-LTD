import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';

export interface CompanyOption {
  id: string;
  name: string;
}

interface AdminCompanyCtx {
  companyId: string | null;
  companies: CompanyOption[];
  companyName: string;
  setCompanyId: (id: string) => void;
  loading: boolean;
}

const AdminCompanyContext = createContext<AdminCompanyCtx>({
  companyId: null,
  companies: [],
  companyName: '',
  setCompanyId: () => {},
  loading: true,
});

export function AdminCompanyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyId, setCompanyIdState] = useState<string | null>(user?.company_id ?? null);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (!user?.company_id && !isSuperAdmin) {
      setCompanyIdState(null);
      setCompanies([]);
      setCompanyName('');
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      if (!isSuperAdmin) {
        const ownCompanyId = user?.company_id;
        if (!ownCompanyId) {setLoading(false);return;}
        // Regular admin — fetch their company name
        const { data } = await supabase
          .from('companies')
          .select('id, name')
          .eq('id', ownCompanyId)
          .maybeSingle();
        if (cancelled) return;
        const name = data?.name || '';
        setCompanyName(name);
        setCompanies([{ id: ownCompanyId, name }]);
        setCompanyIdState(ownCompanyId);
        setLoading(false);
        return;
      }

      // Super admin — fetch all companies
      const { data } = await supabase
        .from('companies')
        .select('id, name')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      const list = (data || []) as CompanyOption[];
      setCompanies(list);
      setCompanyIdState((prev) =>
        prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null
      );
      const selectedName = list.find((c) => c.id === (companyId || list[0]?.id))?.name || '';
      setCompanyName(selectedName);
      setLoading(false);
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [isSuperAdmin, user?.company_id, companyId]);

  const setCompanyId = useCallback(
    (id: string) => {
      setCompanyIdState(id);
      const name = companies.find((c) => c.id === id)?.name || '';
      setCompanyName(name);
    },
    [companies]
  );

  return (
    <AdminCompanyContext.Provider value={{ companyId, companies, companyName, setCompanyId, loading }}>
      {children}
    </AdminCompanyContext.Provider>
  );
}

export function useAdminCompany() {
  return useContext(AdminCompanyContext);
}