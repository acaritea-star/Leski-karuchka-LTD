import { authorize, cors, json } from '../_shared/auth.ts';
import { isUuid } from '../_shared/push.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// Compatibility for cached clients. Postgres creates request events; clients
// can wake existing jobs, never choose their recipients or message contents.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    await authorize(req);
    const input = await req.json();
    if (!!input.user_id === !!input.company_id || !isUuid(input.data?.request_id)) {
      return json({ error: 'A single target and request_id are required' }, 400);
    }
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.rpc('wake_request_push', { p_request_id: input.data.request_id });
    if (error) return json({ error: 'Forbidden or unavailable request' }, 403);
    return json({ queued: true, server_managed: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return json({ error: 'Unable to process request' }, 500);
  }
});
