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
  if (['completed', 'cancelled'].includes(latest.status) && (!previous || previous.status !== latest.status
    || previous.payment_status !== latest.payment_status || previous.online_payment_state !== latest.online_payment_state
    || previous.payment_environment !== latest.payment_environment || previous.final_price !== latest.final_price
    || latest.payment_status === 'refunded' && previous.updated_at !== latest.updated_at)) {
    // One existing aggregate refresh per real settlement/refund transition.
    // Duplicate or stale Realtime events do not restart the wallet request.
    void client.invalidateQueries({ queryKey: queryKeys.driverTodayStats(driverId) });
  }
  client.setQueryData<Request | null>(queryKeys.driverActiveRequest(driverId), current => {
    if (['completed', 'cancelled'].includes(latest.status)) return current?.id === latest.id ? null : current ?? null;
    if (!['accepted', 'arrived', 'in_progress'].includes(latest.status)) return current ?? null;
    if (current && current.id !== latest.id) return current;
    return current ? mergeRequestSnapshot(current, latest) : latest;
  });
}
