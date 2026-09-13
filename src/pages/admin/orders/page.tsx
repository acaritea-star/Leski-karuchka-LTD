import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';

type Order = Tables<'taxi_requests'> & { customer_name: string; driver_name: string };

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Търсене', color: 'text-primary-600', bg: 'bg-primary-100' },
  accepted: { label: 'Шофьор назначен', color: 'text-accent-600', bg: 'bg-accent-100' },
  arrived: { label: 'Шофьорът пристига', color: 'text-accent-600', bg: 'bg-accent-100' },
  in_progress: { label: 'Пътуване', color: 'text-accent-600', bg: 'bg-accent-100' },
  completed: { label: 'Завършено', color: 'text-primary-600', bg: 'bg-primary-100' },
  cancelled: { label: 'Отказано', color: 'text-red-500', bg: 'bg-red-50' },
};

const ACTIVE_STATUSES = ['pending', 'accepted', 'arrived', 'in_progress'];

export default function AdminOrders() {
  const { t } = useTranslation();
  const { companyId } = useAdminCompany();

  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');

  const ordersQuery = useQuery({
    queryKey: companyId ? queryKeys.adminOrders(companyId) : ['taxi_requests', 'company', 'none'],
    queryFn: async (): Promise<Order[]> => {
      const { data: requests, error: reqErr } = await supabase
        .from('taxi_requests')
        .select('*')
        .eq('company_id', companyId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (reqErr) throw reqErr;

      const list = requests ?? [];
      const customerIds = [...new Set(list.map((r) => r.customer_id))];
      const driverIds = list
        .map((r) => r.driver_id)
        .filter((id): id is string => !!id);

      const customerMap: Record<string, string> = {};
      if (customerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, first_name, last_name')
          .in('id', customerIds);
        for (const p of profiles ?? []) {
          customerMap[p.id] = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Клиент';
        }
      }

      const driverUserMap: Record<string, string> = {};
      const driverIdToUserId: Record<string, string> = {};
      if (driverIds.length > 0) {
        const { data: drivers } = await supabase
          .from('drivers')
          .select('id, user_id')
          .in('id', driverIds);
        const driverList = drivers ?? [];
        for (const d of driverList) driverIdToUserId[d.id] = d.user_id;

        const driverUserIds = driverList.map((d) => d.user_id);
        if (driverUserIds.length > 0) {
          const { data: driverProfiles } = await supabase
            .from('profiles')
            .select('id, first_name, last_name')
            .in('id', driverUserIds);
          for (const u of driverProfiles ?? []) {
            driverUserMap[u.id] = `${u.first_name || ''} ${u.last_name || ''}`.trim();
          }
        }
      }

      return list.map((r) => ({
        ...r,
        customer_name: customerMap[r.customer_id] || 'Клиент',
        driver_name: driverUserMap[driverIdToUserId[r.driver_id || '']] || '—',
      }));
    },
    enabled: !!companyId,
  });

  const orders = ordersQuery.data ?? [];
  const error = ordersQuery.error instanceof Error ? ordersQuery.error.message : '';
  const loading = ordersQuery.isLoading;

  const filtered = orders.filter((o) => {
    if (filter === 'active') return ACTIVE_STATUSES.includes(o.status);
    if (filter === 'completed') return o.status === 'completed';
    if (filter === 'cancelled') return o.status === 'cancelled';
    return true;
  });

  const tabs = [
    { key: 'all' as const, label: 'Всички' },
    { key: 'active' as const, label: 'Активни' },
    { key: 'completed' as const, label: 'Завършени' },
    { key: 'cancelled' as const, label: 'Отказани' },
  ];

  return (
    <AdminLayout title={t('nav_orders')}>
      {error && (
        <div className="mb-4 bg-red-50 text-red-600 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <i className="ri-error-warning-line" />
          {error}
          <button onClick={() => ordersQuery.refetch()} className="ml-auto text-xs font-semibold underline cursor-pointer whitespace-nowrap">
            Опитай отново
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
              filter === tab.key
                ? 'bg-primary-500 text-white'
                : 'bg-white text-foreground-500 hover:bg-background-100 border border-background-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-background-100 text-center py-16">
          <i className="ri-file-list-3-line text-4xl text-foreground-300" />
          <p className="text-foreground-500 mt-3">Няма поръчки</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => {
            const status = STATUS_MAP[o.status] || STATUS_MAP.pending;
            return (
              <div key={o.id} className="bg-white rounded-2xl border border-background-100 p-5">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${status.bg} ${status.color}`}>
                      {status.label}
                    </span>
                    <span className="text-xs text-foreground-400">
                      {new Date(o.created_at).toLocaleDateString('bg-BG', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-foreground-950 font-heading">
                    {parseFloat(String(o.final_price || o.estimated_price || 0)).toFixed(2)} €
                  </span>
                </div>

                <div className="flex items-start gap-3 mb-3">
                  <div className="flex flex-col items-center flex-shrink-0 pt-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                    <div className="w-0.5 h-8 bg-background-200 my-0.5" />
                    <div className="w-2.5 h-2.5 rounded bg-foreground-400" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <p className="text-sm text-foreground-900 truncate">{o.pickup_address}</p>
                    <p className="text-sm text-foreground-900 truncate">{o.destination_address}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap text-xs text-foreground-500 pt-3 border-t border-background-100">
                  <span className="flex items-center gap-1">
                    <i className="ri-user-line text-foreground-400" />
                    {o.customer_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="ri-steering-line text-foreground-400" />
                    {o.driver_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <i className="ri-wallet-3-line text-foreground-400" />
                    {o.payment_method === 'cash' ? 'Кеш' : o.payment_method === 'card' ? 'Карта' : 'Онлайн'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}