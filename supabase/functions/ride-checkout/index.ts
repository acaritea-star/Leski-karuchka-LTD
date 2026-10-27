import { authorize,cors,json } from '../_shared/auth.ts';
import { runRideCheckout } from '../_shared/rideCheckout.ts';
import { paymentRpc,requireRideStripe,stripeForRide,rideStripeCredentials,rideWebhookSecret } from '../_shared/rideStripeRuntime.ts';
let liveHealth:{checkedAt:number;pending:Promise<{ready:boolean;reason?:string}>}|undefined;
function healthFailure(reason:string) {
 const legacy=(Deno.env.get('STRIPE_API_KEY')??'').trim();
 console.warn(JSON.stringify({code:'live_payment_not_ready',reason,
  live_key_configured:/^(sk|rk)_live_/.test(rideStripeCredentials.liveKey),
  legacy_key_environment:/^(sk|rk)_live_/.test(legacy)?'live':/^(sk|rk)_test_/.test(legacy)?'test':'missing',
  live_webhook_configured:rideWebhookSecret(true).startsWith('whsec_'),
  legacy_webhook_configured:(Deno.env.get('STRIPE_WEBHOOK_API')??'').trim().startsWith('whsec_')}));
 return {ready:false,reason};
}
export async function rideCheckout(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 // Public availability only: no keys, account identifiers, actor or ride data.
 // Cache the probe so concurrent health checks share one Stripe account read.
 if(request.method==='GET'&&new URL(request.url).searchParams.get('health')==='live') {
  if(!liveHealth||Date.now()-liveHealth.checkedAt>=60000) {
   liveHealth={checkedAt:Date.now(),pending:(async()=>{
    if(!rideWebhookSecret(true).startsWith('whsec_'))return healthFailure('webhook_not_configured');
    try{await requireRideStripe(true,true);return {ready:true};}catch(cause){
     const error=cause as {message?:string;type?:string};
     const reason=error.message==='Stripe key environment mismatch'?'key_environment_mismatch':error.message==='Stripe account mismatch'?'account_mismatch':error.message==='Live merchant is not ready'?'charges_disabled':error.type==='StripeAuthenticationError'?'key_authentication_failed':error.type==='StripePermissionError'?'key_permission_missing':'stripe_unavailable';
     return healthFailure(reason);
    }
   })()};
  }
  return json(await liveHealth.pending);
 }
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 try {
  const actor=await authorize(request);
  const body=await request.text();if(body.length>2000)return json({code:'INVALID_REQUEST'},400);
  const input=JSON.parse(body) as {action?:string;request_id?:string};
  if(input.action==='readiness' && actor.role==='SUPER_ADMIN') {
   const statuses=await Promise.all([false,true].map(async live=>{
    try{return {mode:live?'live':'test',ready:true,account_id:await requireRideStripe(live,true),webhook_secret_configured:rideWebhookSecret(live).startsWith('whsec_')};}
    catch{return {mode:live?'live':'test',ready:false};}
   }));
   return json({environments:statuses});
  }
  if(!['checkout','elements','cancel','reconcile'].includes(input.action??'') || typeof input.request_id!=='string' || !/^[0-9a-f-]{36}$/i.test(input.request_id))return json({code:'INVALID_REQUEST'},400);
  const result=await runRideCheckout(actor.id,input.request_id,input.action as 'checkout'|'elements'|'cancel'|'reconcile',{
   rpc:paymentRpc,requireStripe:requireRideStripe,
   webhookReady:live=>rideWebhookSecret(live).startsWith('whsec_'),
   createCustomer:(live,email,key)=>stripeForRide(live).customers.create(email?{email}:{},{idempotencyKey:key}),
   createSession:(live,params,key)=>stripeForRide(live).checkout.sessions.create(params,{idempotencyKey:key}),
   retrieveSession:(live,id)=>stripeForRide(live).checkout.sessions.retrieve(id,{expand:['payment_intent.latest_charge']}),
   retrievePayment:(live,id)=>stripeForRide(live).paymentIntents.retrieve(id,{expand:['latest_charge']}),
   expireSession:(live,id)=>stripeForRide(live).checkout.sessions.expire(id),
  });
  return new Response(JSON.stringify(result),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch(error) {
  if(error instanceof Response)return error;
  const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
  return json({code:code==='42501'?'PAYMENT_NOT_ALLOWED':'PAYMENT_CHECK_PENDING'},code==='42501'?403:503);
 }
}
Deno.serve(rideCheckout);
