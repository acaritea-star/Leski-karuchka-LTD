import { admin, json } from '../_shared/auth.ts';
import { classifyPushFailure, isAllowedPushEndpoint, isUuid, pushTtl } from '../_shared/push.ts';
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7';

type Job = { id: string; recipient_id: string; payload: Record<string, unknown>; expires_at: string; lease_until: string };
type Subscription = { id: string; endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let jobId: string | undefined;
  let leaseToken: string | undefined;
  let claimed = false;
  const finish = async (result: string, error: string | null = null) => {
    const response = await admin.rpc('finish_push_job', {
      p_job_id: jobId, p_lease_token: leaseToken, p_result: result, p_error: error,
    });
    if (response.error) throw response.error;
    return response.data === true;
  };

  try {
    const body = await req.text();
    if (body.length > 500) return json({ error: 'Invalid capability' }, 403);
    const input = JSON.parse(body);
    if (!isUuid(input?.job_id) || !isUuid(input?.lease_token)) return json({ error: 'Invalid capability' }, 403);
    jobId = input.job_id;
    leaseToken = input.lease_token;

    // Custom auth: exchange a private, short-lived, single-use lease. The
    // service-role-only RPC also rechecks recipient geography and request state.
    const { data, error } = await admin.rpc('claim_push_job', { p_job_id: jobId, p_lease_token: leaseToken });
    if (error) throw error;
    if (!data) return json({ error: 'Invalid or obsolete capability' }, 403);
    claimed = true;
    const job = data as Job;
    if (!pushTtl(job.expires_at)) {
      await finish('skipped', 'EXPIRED');
      return json({ status: 'skipped' });
    }

    const { data: config, error: configError } = await admin.from('app_config')
      .select('vapid_public_key,vapid_private_key').eq('id', 1).maybeSingle();
    if (configError || !config?.vapid_public_key || !config.vapid_private_key) {
      await finish('retry', 'VAPID_UNAVAILABLE');
      return json({ status: 'retry' }, 503);
    }
    webpush.setVapidDetails('mailto:admin@leskikaruchka.com', config.vapid_public_key, config.vapid_private_key);

    const { data: subscriptions, error: subscriptionError } = await admin.from('push_subscriptions')
      .select('id,endpoint,p256dh,auth').eq('user_id', job.recipient_id).eq('is_active', true);
    if (subscriptionError) throw subscriptionError;
    if (!subscriptions?.length) {
      await finish('skipped', 'NO_SUBSCRIPTION');
      return json({ status: 'skipped' });
    }

    const payload = JSON.stringify(job.payload);
    let sent = 0;
    let transient = 0;
    let permanent = 0;
    const disable = async (sub: Subscription) => {
      // An endpoint may have changed owners while delivery was in flight.
      const { error } = await admin.from('push_subscriptions').update({ is_active: false })
        .eq('id', sub.id).eq('user_id', job.recipient_id).eq('endpoint', sub.endpoint);
      if (error) throw error;
    };
    const deliver = async (sub: Subscription) => {
      if (!isAllowedPushEndpoint(sub.endpoint)) {
        permanent++;
        await disable(sub);
        return;
      }
      const remaining = pushTtl(job.expires_at);
      if (!remaining) return;
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload, { timeout: 4000, TTL: remaining });
        sent++;
      } catch (error) {
        const outcome = classifyPushFailure(error);
        if (outcome === 'expired') await disable(sub);
        if (outcome === 'retry') transient++;
        else permanent++;
      }
    };

    // Bound execution below the 30-second lease. Incomplete batches retry with
    // the same notification tag; delivery is at least once, never exactly once.
    const deadline = Math.min(Date.now() + 18_000, Date.parse(job.lease_until) - 5000);
    for (let i = 0; i < subscriptions.length; i += 4) {
      if (Date.now() >= deadline) { transient++; break; }
      await Promise.all((subscriptions as Subscription[]).slice(i, i + 4).map(deliver));
    }
    const outcome = transient ? 'retry' : sent ? 'sent' : permanent ? 'failed' : 'skipped';
    const recorded = await finish(outcome, transient ? 'PROVIDER_TRANSIENT' : permanent ? 'PROVIDER_REJECTED' : null);
    return json({ status: recorded ? outcome : 'lease_expired', sent }, transient ? 503 : 200);
  } catch {
    if (claimed) {
      try { await finish('retry', 'WORKER_ERROR'); } catch { /* Cron reclaims the durable lease. */ }
    }
    // Never expose endpoint URLs, tokens, server keys or provider response text.
    return json({ error: 'Delivery unavailable' }, 503);
  }
});
