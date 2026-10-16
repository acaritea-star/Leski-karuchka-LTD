import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import { withRequestTimeout } from './requestTimeout';
import { mergeDriverActiveRead } from './requestSnapshot';
import type { Tables } from './database.types';

// Pages and the GPS owner observe the same full row and in-flight request.
// Availability controls new offers; an existing ride still needs location.
export function driverActiveRequestOptions(client: QueryClient, driverId: string | undefined) {
  const queryKey = queryKeys.driverActiveRequest(driverId ?? 'none');
  return queryOptions({
    queryKey,
    enabled: !!driverId,
    queryFn: async ({ signal }) => {
      if (!driverId) return null;
      const started = client.getQueryData<Tables<'taxi_requests'> | null>(queryKey);
      const { data, error } = await withRequestTimeout(abort => supabase.from('taxi_requests')
        .select('*').eq('driver_id', driverId).in('status', ['accepted', 'arrived', 'in_progress'])
        .order('created_at', { ascending: false }).limit(1).abortSignal(abort).maybeSingle(), 10_000, signal);
      if (error) throw error;
      return mergeDriverActiveRead(started, client.getQueryData<Tables<'taxi_requests'> | null>(queryKey), data);
    },
  });
}
