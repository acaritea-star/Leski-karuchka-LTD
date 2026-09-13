import { admin, authorize, cors, json } from '../_shared/auth.ts';

// Compatibility endpoint. The single database cron job is the normal scheduler.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  try {
    const serviceToken = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
    if (req.headers.get('Authorization') !== serviceToken) {
      const actor = await authorize(req);
      if (actor.role !== 'SUPER_ADMIN') return json({error:'Administrator required'},403);
    }
    const {data,error} = await admin.rpc('sweep_stuck_requests');
    if (error) return json({error:'Maintenance failed'},500);
    return json({offline_drivers:data});
  } catch(error) { return error instanceof Response ? error : json({error:'Maintenance unavailable'},503); }
});
