import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { isAmbiguousWrite } from '@/lib/rideOperations';

/**
 * Persistent per-driver "declined request" tracking.
 *
 * RLS exposes only requests the current driver is eligible to receive.
 * The first one to accept wins. When a driver rejects a request,
 * that decision must survive page refreshes and the 8s polling refetch —
 * otherwise the request keeps bouncing back. This hook reads/writes the
 * `request_declines` table so a declined request stays hidden for that driver.
 */
export function useDriverDeclines(driverId: string | null | undefined, requestIds: readonly string[] = []) {
  const queryClient = useQueryClient();
  // Only the displayed pending requests matter. Historical refusals must not
  // fill the REST row limit or make every visit read the driver's whole history.
  const ids = [...new Set(requestIds)].sort().slice(0, 50);
  const prefix = ['request_declines', 'driver', driverId ?? 'none'];
  const key = [...prefix, ids];

  const declinesQuery = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!driverId || !ids.length) return [];
      const { data, error } = await withRequestTimeout(abort => supabase
        .from('request_declines')
        .select('request_id')
        .eq('driver_id', driverId).in('request_id', ids).limit(50).abortSignal(abort), 10_000, signal);
      if (error) throw error;
      return (data ?? []).map((d) => d.request_id as string);
    },
    enabled: !!driverId && ids.length > 0,
    staleTime: 10_000,
    retry: 1,
  });

  const declinedIds = useMemo(
    () => new Set(declinesQuery.data ?? []),
    [declinesQuery.data],
  );

  const declineMutation = useMutation({
    mutationKey: prefix,
    mutationFn: async (requestId: string) => {
      if (!driverId || !ids.includes(requestId)) throw new Error('Заявката вече не е в този списък. Обнови го.');
      try {
        const { error } = await withRequestTimeout(signal => supabase.from('request_declines')
          .upsert({ request_id: requestId, driver_id: driverId },
            { onConflict: 'request_id,driver_id', ignoreDuplicates: true }).abortSignal(signal));
        if (error) throw error;
      } catch (cause) {
        if (isAmbiguousWrite(cause)) {
          try {
            const { data, error } = await withRequestTimeout(signal => supabase.from('request_declines')
              .select('request_id').eq('driver_id', driverId).eq('request_id', requestId)
              .abortSignal(signal).maybeSingle(), 5000);
            if (!error && data?.request_id === requestId) return;
          } catch { /* Keep the original error; do not replay an uncertain write. */ }
        }
        throw cause;
      }
    },
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (old = []) =>
        old.includes(requestId) ? old : [...old, requestId],
      );
      return { alreadyDeclined: previous?.includes(requestId) ?? false };
    },
    onError: (_err, requestId, context) => {
      if (!context?.alreadyDeclined) queryClient.setQueryData<string[]>(key, old => (old ?? []).filter(id => id !== requestId));
    },
    onSettled: () => {
      // Refetching during another refusal would erase its optimistic entry.
      if (queryClient.isMutating({ mutationKey: prefix }) === 1) void queryClient.invalidateQueries({ queryKey: prefix });
    },
  });

  return {
    declinedIds,
    decline: declineMutation.mutate,
    declineError: declineMutation.error,
    isDeclining: declineMutation.isPending,
    declinesReady: ids.length === 0 || declinesQuery.data !== undefined,
    declinesLoadError: declinesQuery.error,
    refreshDeclines: () => declinesQuery.refetch(),
  };
}
