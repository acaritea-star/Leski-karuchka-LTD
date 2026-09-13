import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const [tripsResult, driversResult] = await Promise.all([
      adminClient.from('trips').select('id', { count: 'exact', head: true }),
      adminClient.from('drivers').select('rating'),
    ]);

    const completedTrips = tripsResult.count ?? 0;

    const ratings = (driversResult.data ?? [])
      .map((d) => Number(d.rating))
      .filter((r) => Number.isFinite(r));
    const avgRating = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : 0;

    return new Response(
      JSON.stringify({ completed_trips: completedTrips, avg_rating: avgRating }),
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
});