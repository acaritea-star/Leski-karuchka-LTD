import type { QueryClient } from '@tanstack/react-query';
import type { Tables } from './database.types';
import { queryKeys } from './queryKeys';
import { mergeRequestSnapshot } from './requestSnapshot';

type Request = Tables<'taxi_requests'>;
export function cacheDriverRequest(client: QueryClient, driverId: string, incoming: Request) {
  if (incoming.driver_id !== driverId) return;
  // Keep a short-lived per-ride terminal snapshot even when the active key is
  // null. An older mutation acknowledgement cannot reopen that finished ride.
  const key = queryKeys.driverRequestSnapshot(driverId, incoming.id);
  const previous = client.getQueryData<Request>(key);
  const latest = previous ? mergeRequestSnapshot(previous, incoming)! : incoming;
  client.setQueryData(key, latest);
  client.setQueryData<Request | null>(queryKeys.driverActiveRequest(driverId), current => {
    if (['completed', 'cancelled'].includes(latest.status)) return current?.id === latest.id ? null : current ?? null;
    if (!['accepted', 'arrived', 'in_progress'].includes(latest.status)) return current ?? null;
    if (current && current.id !== latest.id) return current;
    return current ? mergeRequestSnapshot(current, latest) : latest;
  });
}
