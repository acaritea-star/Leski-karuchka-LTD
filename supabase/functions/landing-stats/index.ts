import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createLandingStatsHandler } from '../_shared/landingStats.ts';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
Deno.serve(createLandingStatsHandler(async () => {
  const { data, error } = await admin.rpc('read_landing_stats');
  if (error || !data) throw Error('Aggregate unavailable');
  return data;
}));
