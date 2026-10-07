import { useEffect, useReducer } from 'react';
import type { Tables } from '@/lib/database.types';
type Pending = Pick<Tables<'taxi_requests'>, 'status' | 'created_at' | 'expires_at'>;
export function requestDeadline(request: Pending): number {
  return request.expires_at ? Date.parse(request.expires_at) : Date.parse(request.created_at) + 120_000;
}
export function isOpenRequest(request: Pending, now = Date.now()): boolean {
  return request.status === 'pending' && requestDeadline(request) > now;
}
/** One local deadline timer; no database query or per-second list repaint. */
export function useFreshRequests<T extends Pending>(requests: T[]): T[] {
  const [revision, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const now = Date.now();
    const next = requests.reduce((nearest, request) => {
      const deadline = requestDeadline(request);
      return deadline > now ? Math.min(nearest, deadline) : nearest;
    }, Infinity);
    const timer = Number.isFinite(next) ? setTimeout(refresh, Math.min(2_147_483_647, next - now + 1)) : undefined;
    const resume = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [requests, revision]);
  return requests.filter(request => isOpenRequest(request));
}
