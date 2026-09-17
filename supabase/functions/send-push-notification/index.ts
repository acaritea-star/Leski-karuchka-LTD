import { authorize, admin, json } from '../_shared/auth.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface PushPayload {
  user_id?: string;
  company_id?: string;
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  requireInteraction?: boolean;
  renotify?: boolean;
  vibrate?: number[];
}

async function getVapidKeys(): Promise<{ publicKey: string; privateKey: string } | null> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await adminClient
    .from('app_config')
    .select('vapid_public_key, vapid_private_key')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data?.vapid_public_key || !data?.vapid_private_key) return null;
  return { publicKey: data.vapid_public_key, privateKey: data.vapid_private_key };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const actor = await authorize(req);
    const vapid = await getVapidKeys();
    if (!vapid) {
      return new Response(
        JSON.stringify({
          error: 'VAPID keys not configured',
          help: 'Call POST /functions/v1/generate-vapid-keys first to create the keys.',
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    }

    webpush.setVapidDetails(
      'mailto:admin@leskikaruchka.com',
      vapid.publicKey,
      vapid.privateKey,
    );

    const payload: PushPayload = await req.json();

    if (!!payload.user_id === !!payload.company_id) {
      return new Response(JSON.stringify({ error: 'Provide exactly one recipient target' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (typeof payload.title !== 'string' || typeof payload.body !== 'string' || payload.title.length>150 || payload.body.length>1000) return json({error:'Invalid message'},400);
    if (payload.company_id) {
      const requestId = payload.data?.request_id;
      if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return json({error:'Invalid request_id'},400);
      const {data:ride} = await admin.from('taxi_requests').select('id,pickup_address,destination_address')
        .eq('id',requestId).eq('company_id',payload.company_id).eq('customer_id',actor.id).eq('status','pending')
        .gte('created_at',new Date(Date.now()-120000).toISOString()).maybeSingle();
      if (!ride) return json({error:'No matching pending ride'},403);
      payload.title='Нова заявка'; payload.body=`${ride.pickup_address} → ${ride.destination_address}`;
      payload.data={request_id:ride.id,type:'new_request',role:'DRIVER'};
    } else if (payload.user_id !== actor.id) {
      const {data:driver} = await admin.from('drivers').select('id').eq('user_id',actor.id).maybeSingle();
      if (!driver) return json({error:'Forbidden recipient'},403);
      const {data:ride} = await admin.from('taxi_requests').select('id,status')
        .eq('driver_id',driver.id).eq('customer_id',payload.user_id)
        .gte('updated_at',new Date(Date.now()-600000).toISOString()).order('updated_at',{ascending:false}).limit(1).maybeSingle();
      if (!ride) return json({error:'Forbidden recipient'},403);
      payload.data={request_id:ride.id,type:'trip_status',role:'CUSTOMER',status:ride.status};
    }

    // Query subscriptions
    let subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }> = [];

    if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      if (payload.user_id) {
        const { data, error } = await adminClient
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('is_active', true)
          .eq('user_id', payload.user_id);
        if (error) throw error;
        if (data) subscriptions = data;
      } else if (payload.company_id) {
        // The database uses the same GPS/vehicle rule as feed access and acceptance.
        const { data: onlineDrivers, error: recipientError } = await adminClient
          .rpc('request_push_recipients', { p_request_id: payload.data?.request_id });
        if (recipientError) throw recipientError;

        if (onlineDrivers && onlineDrivers.length > 0) {
          const userIds = onlineDrivers.map((d: { user_id: string }) => d.user_id);
          const { data, error } = await adminClient
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth')
            .eq('is_active', true)
            .in('user_id', userIds);
          if (error) throw error;
          if (data) subscriptions = data;
        }
      }
    }

    if (subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, message: 'No push subscriptions found' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        },
      );
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icon-192.png',
      badge: payload.badge || '/badge-72.png',
      tag: payload.tag || 'taxi-notification',
      data: payload.data || {},
      requireInteraction: payload.requireInteraction ?? false,
      renotify: payload.renotify ?? true,
      vibrate: payload.vibrate || [200, 100, 200],
    });

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      // A client can register an endpoint; never let it turn this server into an arbitrary HTTP caller.
      let target: URL;
      try { target = new URL(sub.endpoint); } catch { failed++; continue; }
      if (target.protocol !== 'https:' || target.username || target.password || target.port ||
        !(['fcm.googleapis.com','web.push.apple.com'].includes(target.hostname) || target.hostname.endsWith('.push.services.mozilla.com') || target.hostname.endsWith('.notify.windows.com'))) { failed++; continue; }

      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, notificationPayload, { timeout: 5000 });
        sent++;
      } catch (err) {
        failed++;
        const errMsg = (err as Error)?.message || String(err);
        errors.push(errMsg);

        if (
          errMsg.includes('expired') ||
          errMsg.includes('InvalidRegistration') ||
          errMsg.includes('NotRegistered') ||
          (err as { statusCode?: number })?.statusCode === 410
        ) {
          if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
            const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
              auth: { autoRefreshToken: false, persistSession: false },
            });
            await adminClient.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ sent, failed, errors: errors.slice(0, 3) }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      },
    );
  }
});
