import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
export function useDriverDispatchIdentity(owner?: string, vehicle?: string | null) {
  return useQuery({ queryKey: ['driver-dispatch-identity', owner, vehicle], enabled: !!owner && !!vehicle, staleTime: 300_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await withRequestTimeout(abort => supabase.from('vehicles')
        .select('id,companies(name),vehicle_types(name)').eq('id', vehicle!).abortSignal(abort).maybeSingle(), 10_000, signal);
      if (error) throw error;
      return { company: data?.companies?.name, category: data?.vehicle_types?.name };
    },
  });
}
