import { queryOptions } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import { withRequestTimeout } from './requestTimeout';

// Every observer of this key stores the same full row. Observer-specific
// select() projections must never replace the shared driver's online/GPS data.
export function driverRecordOptions(userId: string | undefined) {
  return queryOptions({
    queryKey: queryKeys.driverRecord(userId ?? 'none'),
    queryFn: async ({ signal }) => {
      if (!userId) return null;
      const { data, error } = await withRequestTimeout(abort => supabase.from('drivers')
        .select('*').eq('user_id', userId).abortSignal(abort).maybeSingle(), 10_000, signal, 'driver.read');
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}
