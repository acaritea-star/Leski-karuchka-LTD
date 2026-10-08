import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { loadCustomers, ADMIN_PAGE_SIZE } from '@/lib/adminData';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

export default function AdminCustomers() {
  const { companyId } = useAdminCompany();
  return <CustomerList key={companyId ?? 'none'} />;
}

function CustomerList() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => { setSearchTerm(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const customersQuery = useQuery({
    queryKey: [...queryKeys.adminCustomers(companyId ?? 'none'), searchTerm, page],
    queryFn: ({ signal }) => loadCustomers(companyId!, searchTerm, page, signal),
    enabled: !!companyId,
  });

  const customers = customersQuery.data?.rows ?? [];
  const total = customersQuery.data?.total ?? 0;
  const error = customersQuery.error instanceof Error ? customersQuery.error.message : '';
  const loading = customersQuery.isLoading;

  const filtered = customers;

  return (
    <AdminLayout title={t('nav_customers')}>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => customersQuery.refetch()} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
          <input
            type="text"
            maxLength={80}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Търси по име..."
            className="w-full pl-9 pr-4 py-2.5 bg-white rounded-xl border border-background-200 text-sm text-foreground-950 placeholder:text-foreground-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <div className="text-sm text-foreground-500 whitespace-nowrap">{total} клиенти</div>
      </div>
      <p className="mb-4 text-xs text-foreground-500">Показани са завършените курсове към тази фирма. Стойността им е прогнозна, не доказателство за получени пари.</p>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-user-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма намерени клиенти</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-background-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-foreground-500 border-b border-background-100">
                  <th className="px-5 py-3 font-medium">Клиент</th>
                  <th className="px-5 py-3 font-medium">Телефон</th>
                  <th className="px-5 py-3 font-medium text-center">Завършени курсове</th>
                  <th className="px-5 py-3 font-medium text-right">Стойност на курсовете</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-background-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-background-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          {c.avatar_url ? (
                            <img src={c.avatar_url} alt="" className="w-full h-full rounded-full object-cover" />
                          ) : (
                            <span className="text-primary-700 font-bold text-sm font-heading">
                              {`${c.first_name?.charAt(0) ?? ''}${c.last_name?.charAt(0) ?? ''}`.toUpperCase() || 'К'}
                            </span>
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-foreground-900">
                            {c.first_name || ''} {c.last_name || ''}
                          </p>
                          <p className="text-xs text-foreground-400">
                            {new Date(c.created_at).toLocaleDateString('bg-BG')}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-foreground-600">{c.phone || '—'}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className="inline-flex items-center justify-center min-w-[32px] px-2 py-0.5 rounded-full bg-background-100 text-foreground-700 font-medium">
                        {c.totalTrips}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-semibold text-foreground-950 font-heading">
                      {c.totalSpent.toFixed(2)} €
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {total > ADMIN_PAGE_SIZE && <div className="mt-4 flex items-center justify-between text-sm">
        <button className="text-primary-600 disabled:opacity-40" disabled={page === 0 || customersQuery.isFetching} onClick={() => setPage(p => p - 1)}>Назад</button>
        <span>Страница {page + 1} от {Math.ceil(total / ADMIN_PAGE_SIZE)}</span>
        <button className="text-primary-600 disabled:opacity-40" disabled={(page + 1) * ADMIN_PAGE_SIZE >= total || customersQuery.isFetching} onClick={() => setPage(p => p + 1)}>Напред</button>
      </div>}
    </AdminLayout>
  );
}
