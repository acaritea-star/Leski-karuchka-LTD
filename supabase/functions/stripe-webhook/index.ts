import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createStripeSandboxHandler, SANDBOX_ACCOUNT } from '../_shared/stripeSandbox.ts';
import { createStripeWebhookDispatcher } from '../_shared/stripeWebhookDispatcher.ts';
import { createRideStripeWebhook } from '../_shared/rideStripe.ts';
import { rideStripe,rideStripeDependencies } from '../_shared/rideStripeRuntime.ts';

const stripe = new Stripe(Deno.env.get('STRIPE_API_KEY')!,{timeout:6000,maxNetworkRetries:0});
const supabase = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
 auth: { persistSession: false, autoRefreshToken: false },
});
let accountCheck: Promise<void> | undefined;
async function checkAccount() {
 // The webhook signing secret authenticates the sender. This extra check binds
 // reconciliation API reads to the same dedicated sandbox, never the live key.
 if (!accountCheck) accountCheck = stripe.accounts.retrieve().then(account => {
  if (account.id!==SANDBOX_ACCOUNT) throw Error('Stripe key is for another account');
 }).catch(error => { accountCheck=undefined; throw error; });
 await accountCheck;
}
const sandboxVerify=(body:string,signature:string)=>stripe.webhooks.constructEventAsync(body,signature,(Deno.env.get('STRIPE_WEBHOOK_API')??'').trim(),undefined,Stripe.createSubtleCryptoProvider());
const liveVerify=(body:string,signature:string)=>rideStripe.webhooks.constructEventAsync(body,signature,(Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')??'').trim(),undefined,Stripe.createSubtleCryptoProvider());
const sandboxHandler=createStripeSandboxHandler({
 verify: sandboxVerify,
 retrievePayment: async id => {
  await checkAccount();
  return stripe.paymentIntents.retrieve(id,{expand:['latest_charge']});
 },
 record: async event => {
  const result = await supabase.rpc('record_stripe_sandbox_event',{p_event:event}).abortSignal(AbortSignal.timeout(8000));
  return {data:result.data,error:result.error};
 },
});
Deno.serve(createStripeWebhookDispatcher({sandboxVerify,liveVerify,sandbox:sandboxHandler,
 live:createRideStripeWebhook({...rideStripeDependencies,verify:liveVerify}),
}));

