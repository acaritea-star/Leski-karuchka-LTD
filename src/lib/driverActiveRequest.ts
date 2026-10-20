import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { queryKeys } from './queryKeys';
import { withRequestTimeout } from './requestTimeout';
import { mergeDriverActiveRead, mergeRequestSnapshot } from './requestSnapshot';
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
      const merged = mergeDriverActiveRead(started, client.getQueryData<Tables<'taxi_requests'> | null>(queryKey), data);
      if (!merged) return null;
      // A terminal event can leave the active cache null both before and after
      // this read. Its per-ride snapshot must still defeat a stale active row.
      const snapshot = client.getQueryData<Tables<'taxi_requests'>>(queryKeys.driverRequestSnapshot(driverId, merged.id));
      const latest = snapshot ? mergeRequestSnapshot(snapshot, merged) : merged;
      return latest && !['completed', 'cancelled'].includes(latest.status) ? latest : null;
    },
  });
}
