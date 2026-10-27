import Stripe from 'npm:stripe@22.6.0';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { createStripeSandboxHandler, SANDBOX_ACCOUNT, TEST_MODE_ACCOUNT } from '../_shared/stripeSandbox.ts';
import { createStripeWebhookDispatcher } from '../_shared/stripeWebhookDispatcher.ts';
import { createRideStripeWebhook } from '../_shared/rideStripe.ts';
import { rideStripe,rideStripeDependencies,rideStripeDependenciesForMode,rideWebhookSecret } from '../_shared/rideStripeRuntime.ts';

const sandboxKey=(Deno.env.get('STRIPE_API_KEY')??'').trim();
const stripe = new Stripe(sandboxKey||'not_configured',{timeout:6000,maxNetworkRetries:0});
const supabase = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
 auth: { persistSession: false, autoRefreshToken: false },
});
let accountCheck: Promise<string> | undefined;
async function checkAccount() {
 // The webhook signing secret authenticates the sender. This extra check binds
 // reconciliation API reads to the same dedicated sandbox, never the live key.
 if(!/^(sk|rk)_test_/.test(sandboxKey))throw Error('Test key required');
 if (!accountCheck) accountCheck = stripe.accounts.retrieve(null).then(account => {
  if (![SANDBOX_ACCOUNT,TEST_MODE_ACCOUNT].includes(account.id)) throw Error('Stripe key is for another account');
  return account.id;
 }).catch(error => { accountCheck=undefined; throw error; });
 return await accountCheck;
}
function verifier(client:Stripe,readSecret:()=>string,environment:'sandbox'|'live') {
 return async(body:string,signature:string)=>{
  const secret=readSecret();
  if(!secret)throw Error('Signing secret unavailable');
  try{return await client.webhooks.constructEventAsync(body,signature,secret,undefined,Stripe.createSubtleCryptoProvider());}
  catch(error){
   // Never log the key, signing secret, signature, raw body or SDK error message.
   // A fixed category distinguishes configuration failures from malformed input.
   const detail=error && typeof error==='object'?error as {name?:unknown;type?:unknown;message?:unknown}:{};
   const name=typeof detail.type==='string'?detail.type:typeof detail.name==='string'?detail.name:'';
   const message=typeof detail.message==='string'?detail.message:'';
   const failure=message.startsWith('No signatures found matching')?'signature_mismatch':
    message.startsWith('Timestamp outside')?'timestamp_outside_tolerance':
    ['StripeSignatureVerificationError','TypeError','ReferenceError'].includes(name)?name:'verification_error';
   console.warn(JSON.stringify({code:'stripe_webhook_verification_failed',environment,
    signing_secret_configured:secret.startsWith('whsec_'),
    failure}));
   throw error;
  }
 };
}
const sandboxVerify=verifier(stripe,()=>rideWebhookSecret(false),'sandbox');
const liveVerify=verifier(rideStripe,()=>rideWebhookSecret(true),'live');
const legacySandboxHandler=createStripeSandboxHandler({
 accountId:checkAccount,
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
const testRideHandler=createRideStripeWebhook({...rideStripeDependenciesForMode(false),verify:sandboxVerify,livemode:false});
const sandboxHandler=async(request:Request)=>{
 const result=await testRideHandler(request.clone());
 if(result.status===200 && ['unrelated','ignored'].includes((await result.clone().json()).result))return legacySandboxHandler(request);
 return result;
};
Deno.serve(createStripeWebhookDispatcher({sandboxVerify,liveVerify,sandbox:sandboxHandler,
 live:createRideStripeWebhook({...rideStripeDependencies,verify:liveVerify}),
}));


