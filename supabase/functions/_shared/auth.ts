import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
});
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
export async function authorize(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Response('Authentication required', { status: 401, headers: cors });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new Response('Invalid session', { status: 401, headers: cors });
  const { data: profile, error: profileError } = await admin.from('profiles').select('id,role,company_id,is_active').eq('id', data.user.id).maybeSingle();
  if (profileError) throw new Response('Account service unavailable', { status: 503, headers: cors });
  if (!profile?.is_active) throw new Response('Active account required', { status: 403, headers: cors });
  const { data: allowed, error: limitError } = await admin.rpc('consume_api_budget', { p_user_id: data.user.id });
  if (limitError) throw new Response('Service unavailable', { status: 503, headers: cors });
  if (!allowed) throw new Response('Too many requests; retry in one minute', { status: 429, headers: cors });
  return profile;
}
export const validPoint = (point: unknown): point is { lat: number; lng: number } => {
  if (!point || typeof point !== 'object') return false;
  const { lat, lng } = point as {lat: number; lng: number};
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
};
