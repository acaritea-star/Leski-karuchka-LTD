import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Persistent per-driver "declined request" tracking.
 *
 * The taxi dispatch is broadcast: every online driver sees the same pending
 * requests and the first one to accept wins. When a driver rejects a request,
 * that decision must survive page refreshes and the 8s polling refetch —
 * otherwise the request keeps bouncing back. This hook reads/writes the
 * `request_declines` table so a declined request stays hidden for that driver.
 */
export function useDriverDeclines(driverId: string | null | undefined) {
  const queryClient = useQueryClient();
  const key = ['request_declines', 'driver', driverId ?? 'none'];

  const declinesQuery = useQuery({
    queryKey: key,
    queryFn: async () => {
      if (!driverId) return [];
      const { data, error } = await supabase
        .from('request_declines')
        .select('request_id')
        .eq('driver_id', driverId);
      if (error) throw error;
      return (data ?? []).map((d) => d.request_id as string);
    },
    enabled: !!driverId,
  });

  const declinedIds = useMemo(
    () => new Set(declinesQuery.data ?? []),
    [declinesQuery.data],
  );

  const declineMutation = useMutation({
    mutationFn: async (requestId: string) => {
      if (!driverId) throw new Error('No driver record');
      const { error } = await supabase
        .from('request_declines')
        .upsert(
          { request_id: requestId, driver_id: driverId },
          { onConflict: 'request_id,driver_id' },
        );
      if (error) throw error;
    },
    onMutate: async (requestId) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (old = []) =>
        old.includes(requestId) ? old : [...old, requestId],
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });

  return {
    declinedIds,
    decline: declineMutation.mutate,
    declineError: declineMutation.error,
    isDeclining: declineMutation.isPending,
  };
}