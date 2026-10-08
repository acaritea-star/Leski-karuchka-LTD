import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { ADMIN_PAGE_SIZE } from './adminData';

export type OrderFilter = 'all' | 'active' | 'completed' | 'cancelled';
export async function loadAdminOrders(companyId: string, filter: OrderFilter, page = 0, signal?: AbortSignal) {
  const { data, error, count } = await withRequestTimeout(abort => {
    let query = supabase.from('taxi_requests').select(
      'id,status,created_at,final_price,estimated_price,pickup_address,destination_address,payment_method,profiles!taxi_requests_customer_id_fkey(first_name,last_name),drivers!taxi_requests_driver_id_fkey(profiles!drivers_user_id_fkey(first_name,last_name))',
      { count: 'exact' },
    ).eq('company_id', companyId);
    // Filter on the server BEFORE paging; older active rides must not disappear
    // behind a busy company's most recent completed requests.
    if (filter === 'active') query = query.in('status', ['pending', 'accepted', 'arrived', 'in_progress']);
    else if (filter !== 'all') query = query.eq('status', filter);
    return query.order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(page * ADMIN_PAGE_SIZE, (page + 1) * ADMIN_PAGE_SIZE - 1).abortSignal(abort);
  }, 10_000, signal);
  if (error) throw error;
  const name = (p: { first_name: string | null; last_name: string | null } | null) => `${p?.first_name ?? ''} ${p?.last_name ?? ''}`.trim();
  return { total: count ?? 0, rows: (data ?? []).map(({ profiles, drivers, ...row }) => ({
    ...row, customer_name: name(profiles) || 'Клиент', driver_name: name(drivers?.profiles ?? null) || '—',
  })) };
}
