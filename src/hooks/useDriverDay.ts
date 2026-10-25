import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { loadDriverDay } from '@/lib/serverSummaries';
import { useSofiaDay } from './useSofiaDay';

/** Home statistics and the pinned wallet share one bounded server aggregate. */
export function useDriverDay(driverId: string | undefined) {
  const day = useSofiaDay();
  return useQuery({
    queryKey: queryKeys.driverTodayStats(driverId ?? 'none', day),
    queryFn: ({ signal }) => loadDriverDay(driverId!, signal),
    enabled: !!driverId, staleTime: 30_000, retry: 1,
    refetchOnWindowFocus: true,
  });
}
