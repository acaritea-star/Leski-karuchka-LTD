import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import type { Tables } from './database.types';
import type { RequestMetric } from './requestMetrics';

type Request = Tables<'taxi_requests'>;
type Reply = { data: Request | null; error: unknown };
type Target = 'arrived' | 'in_progress' | 'completed';
const phase = { pending: 0, accepted: 1, arrived: 2, in_progress: 3, completed: 4, cancelled: 4 };
const message = (cause: unknown) => cause instanceof Error ? cause
  : new Error(cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : 'Промяната не е потвърдена.');
export function isAmbiguousWrite(cause: unknown) {
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return true;
  if (cause.code == null || cause.code === '') return true;
  // Expected business/auth/constraint failures did not commit the operation.
  return cause.code === 'PGRST116' || /^PGRST00/.test(String(cause.code));
}

async function confirmedWrite(write: (signal: AbortSignal) => PromiseLike<Reply>,
  requestId: string, confirms: (row: Request) => boolean, metric: RequestMetric): Promise<Request> {
  try {
    const { data, error } = await withRequestTimeout(write, 15_000, undefined, metric);
    if (error) throw error;
    if (!data || !confirms(data)) throw new Error('Промяната не е потвърдена.');
    return data;
  } catch (cause) {
    if (isAmbiguousWrite(cause)) {
      try {
        // Abort only stops waiting. A received write may already be committed.
        // Reconcile once; never automatically replay an uncertain mutation.
        const { data, error } = await withRequestTimeout(signal => supabase.from('taxi_requests')
          .select('*').eq('id', requestId).abortSignal(signal).maybeSingle(), 5000, undefined, 'ride.reconcile');
        if (!error && data?.id === requestId && confirms(data)) return data;
      } catch { /* Keep the original actionable error if reconciliation fails. */ }
    }
    throw message(cause);
  }
}

export function acceptTaxiRequest(requestId: string, driverId: string) {
  return confirmedWrite(signal => supabase.rpc('accept_taxi_request', { p_request_id: requestId }).abortSignal(signal),
    requestId, row => row.id === requestId && row.driver_id === driverId && ['accepted', 'arrived', 'in_progress', 'completed'].includes(row.status), 'ride.accept');
}

export function transitionTaxiRequest(request: Request, target: Target) {
  return confirmedWrite(signal => supabase.from('taxi_requests')
    .update({ status: target })
    .eq('id', request.id).eq('status', request.status).select('*').abortSignal(signal).single(),
  request.id, row => row.id === request.id && row.driver_id === request.driver_id && row.status !== 'cancelled' && phase[row.status] >= phase[target], 'ride.transition');
}

export function cancelTaxiRequest(requestId: string, status: Request['status']) {
  return confirmedWrite(signal => supabase.from('taxi_requests')
    .update({ status: 'cancelled', cancel_reason: 'customer_requested' })
    .eq('id', requestId).eq('status', status).select('*').abortSignal(signal).single(),
  requestId, row => row.id === requestId && row.status === 'cancelled', 'ride.cancel');
}

export function createTaxiRequest(quoteId: string, requestId: string, customerId: string) {
  // The RPC locks the customer's quote and returns its linked request when
  // already used. That existing ID can differ from this browser's new key;
  // quote_id is not a taxi_requests column. Recovery still requires requestId.
  return confirmedWrite(signal => supabase.rpc('create_taxi_request', {
    p_quote_id: quoteId, p_request_id: requestId, p_payment_method: 'cash',
  }).abortSignal(signal), requestId, row => !!row.id && row.customer_id === customerId, 'ride.create');
}
