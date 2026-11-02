export type LandingStats = { completed_trips: number; avg_rating: number };
const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff',
};
/** Memory cache/single flight protect each warm worker. The RPC has a shared
 * database cache. This worker rate limit is not a global DDoS firewall. */
export function createLandingStatsHandler(load: () => Promise<LandingStats>, now = Date.now) {
  let cached: LandingStats | undefined;
  let expires = 0, retryAfter = 0, windowStart = now(), hits = 0;
  let pending: Promise<LandingStats> | undefined;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...headers, Allow: 'GET, OPTIONS', 'Cache-Control': 'no-store' },
    });
    const time = now();
    if (time - windowStart >= 60_000) { windowStart = time; hits = 0; }
    if (++hits > 300) return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429, headers: { ...headers, 'Retry-After': String(Math.max(1, Math.ceil((windowStart + 60_000 - time) / 1000))), 'Cache-Control': 'no-store' },
    });
    try {
      if (!cached || time >= expires) {
        if (time < retryAfter) throw Error('Refresh cooling down');
        pending ??= load().then((value) => {
          if (!Number.isSafeInteger(value.completed_trips) || value.completed_trips < 0 ||
              !Number.isFinite(value.avg_rating) || value.avg_rating < 0 || value.avg_rating > 5) throw Error('Invalid aggregate');
          cached = { completed_trips: value.completed_trips, avg_rating: value.avg_rating };
          expires = now() + 60_000;
          return cached;
        }).catch(() => { retryAfter = now() + 5000; throw Error('Refresh unavailable'); })
          .finally(() => { pending = undefined; });
        await pending;
      }
      return new Response(JSON.stringify(cached), { headers: { ...headers, 'Cache-Control': 'public, max-age=30, s-maxage=60' } });
    } catch {
      return new Response(JSON.stringify({ error: 'Statistics temporarily unavailable' }), {
        status: 503, headers: { ...headers, 'Retry-After': '5', 'Cache-Control': 'no-store' },
      });
    }
  };
}
