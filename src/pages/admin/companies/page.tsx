import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useQueryClient } from '@tanstack/react-query';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { useNavigate } from 'react-router-dom';
import PartnerInvitations from '@/components/feature/PartnerInvitations';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

interface Company {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  currency: string;
  base_fare: number;
  price_per_km: number;
  price_per_minute: number;
  dispatch_radius_km: number;
  is_active: boolean;
  created_at: string;
  setup_completed_at: string | null;
  drivers_count: number;
}

export default function AdminCompanies() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { companies: availableCompanies, setCompanyId } = useAdminCompany();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [representative, setRepresentative] = useState<Company | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await withRequestTimeout(signal => supabase
        .from('companies')
        .select('id, name, phone, email, address, currency, base_fare, price_per_km, price_per_minute, dispatch_radius_km, is_active, created_at, setup_completed_at, drivers(count)')
        .order('created_at', { ascending: false }).order('id').abortSignal(signal));

      if (err) throw err;

      setCompanies(
        (data || []).map((c) => ({
          ...c,
          base_fare: parseFloat(String(c.base_fare || 0)),
          price_per_km: parseFloat(String(c.price_per_km || 0)),
          price_per_minute: parseFloat(String(c.price_per_minute || 0)),
          dispatch_radius_km: parseFloat(String(c.dispatch_radius_km || 0)),
          drivers_count: c.drivers[0]?.count ?? 0,
        })) as Company[]
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Грешка при зареждане';
      setError(msg);
      console.error('Companies error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  return (
    <AdminLayout title="Фирми">
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => setError('')} className="ml-auto w-5 h-5 flex items-center justify-center cursor-pointer">
            <i className="ri-close-line text-red-400 text-xs" />
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-foreground-500">{companies.length} фирми</div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
        >
          <i className="ri-add-line" />
          Добави фирма
        </button>
      </div>

      <p className="mb-4 text-sm text-foreground-500">Тук управляваш всички фирми като супер администратор. Избери „Управлявай“, за да отвориш конкретна фирма. Новите фирми започват с лична покана по имейл. За съществуваща фирма използвай „Покани представител“.</p>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : companies.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-building-2-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма добавени фирми</p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 px-4 py-2.5 rounded-lg bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer"
          >
            Добави първата фирма
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {companies.map((c) => (
            <div key={c.id} className="bg-white rounded-2xl border border-background-100 p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <i className="ri-building-2-line text-primary-600 text-lg" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground-950 font-heading truncate">{c.name}</p>
                    <p className="text-xs text-foreground-500">{c.currency}</p>
                  </div>
                </div>
                {c.is_active && (
                  <span className="text-[11px] font-semibold text-primary-600 bg-primary-100 px-2 py-1 rounded-full whitespace-nowrap">
                    Активна
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Шофьори</p>
                  <p className="text-foreground-800">{c.drivers_count}</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Начална такса</p>
                  <p className="text-foreground-800">{c.base_fare.toFixed(2)} €</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Цена на км</p>
                  <p className="text-foreground-800">{c.price_per_km.toFixed(2)} €</p>
                </div>
                <div className="bg-background-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-foreground-400">Цена на минута</p>
                  <p className="text-foreground-800">{c.price_per_minute.toFixed(2)} €</p>
                </div>
              </div>

              <div className="space-y-1 text-xs text-foreground-500 mb-4">
                {c.address && (
                  <p className="flex items-center gap-1.5 truncate">
                    <i className="ri-map-pin-line text-foreground-400" />
                    {c.address}
                  </p>
                )}
                {c.phone && (
                  <p className="flex items-center gap-1.5">
                    <i className="ri-phone-line text-foreground-400" />
                    {c.phone}
                  </p>
                )}
                {c.email && (
                  <p className="flex items-center gap-1.5 truncate">
                    <i className="ri-mail-line text-foreground-400" />
                    {c.email}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-foreground-400">
                Добавена: {new Date(c.created_at).toLocaleDateString('bg-BG')}
              </p>
              <button type="button" disabled={!availableCompanies.some(company => company.id === c.id)}
                onClick={() => { setCompanyId(c.id); navigate(c.setup_completed_at === null ? '/company/setup?company=' + c.id : '/admin/dashboard'); }}
                aria-label={`Управлявай ${c.name}`}
                className="mt-3 w-full py-2.5 rounded-lg bg-primary-50 text-primary-700 text-sm font-semibold hover:bg-primary-100 disabled:opacity-50 cursor-pointer">
                {c.setup_completed_at === null ? 'Довърши настройката' : 'Управлявай'}
              </button>
              {c.setup_completed_at !== null && <button onClick={() => setRepresentative(c)} className="mt-2 w-full text-sm text-primary-700 underline">Покани представител</button>}
            </div>
          ))}
        </div>
      )}

      {(showForm || representative) && <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40" onClick={() => { setShowForm(false); setRepresentative(null); }} />
        <div role="dialog" aria-modal="true" aria-label="Покана за фирма" className="relative bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5 space-y-4">
          <div className="flex justify-between items-center"><h3 className="font-semibold font-heading">{representative ? 'Представител на ' + representative.name : 'Покани нова фирма'}</h3><button aria-label="Затвори" onClick={() => { setShowForm(false); setRepresentative(null); void fetchCompanies(); void queryClient.invalidateQueries({ queryKey: ['admin-companies'] }); }} className="p-2">×</button></div>
          <PartnerInvitations key={representative?.id ?? 'new'} kind="company" companyId={representative?.id} />
        </div>
      </div>}
    </AdminLayout>
  );
}
