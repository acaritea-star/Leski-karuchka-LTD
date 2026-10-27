import { authorize,cors,json } from '../_shared/auth.ts';
import { runRideCheckout } from '../_shared/rideCheckout.ts';
import { paymentRpc,requireRideStripe,stripeForRide } from '../_shared/rideStripeRuntime.ts';
let liveHealth:{checkedAt:number;pending:Promise<boolean>}|undefined;
export async function rideCheckout(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 // Public availability only: no keys, account identifiers, actor or ride data.
 // Cache the probe so concurrent health checks share one Stripe account read.
 if(request.method==='GET'&&new URL(request.url).searchParams.get('health')==='live') {
  if(!liveHealth||Date.now()-liveHealth.checkedAt>=60000) {
   liveHealth={checkedAt:Date.now(),pending:(async()=>{
    if(!(Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')??'').trim().startsWith('whsec_'))return false;
    try{await requireRideStripe(true,true);return true;}catch{return false;}
   })()};
  }
  return json({ready:await liveHealth.pending});
 }
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 try {
  const actor=await authorize(request);
  const body=await request.text();if(body.length>2000)return json({code:'INVALID_REQUEST'},400);
  const input=JSON.parse(body) as {action?:string;request_id?:string};
  if(input.action==='readiness' && actor.role==='SUPER_ADMIN') {
   const statuses=await Promise.all([false,true].map(async live=>{
    try{return {mode:live?'live':'test',ready:true,account_id:await requireRideStripe(live,true),webhook_secret_configured:!!Deno.env.get(live?'STRIPE_LIVE_WEBHOOK_SECRET':'STRIPE_WEBHOOK_API')};}
    catch{return {mode:live?'live':'test',ready:false};}
   }));
   return json({environments:statuses});
  }
  if(!['checkout','elements','cancel','reconcile'].includes(input.action??'') || typeof input.request_id!=='string' || !/^[0-9a-f-]{36}$/i.test(input.request_id))return json({code:'INVALID_REQUEST'},400);
  const result=await runRideCheckout(actor.id,input.request_id,input.action as 'checkout'|'elements'|'cancel'|'reconcile',{
   rpc:paymentRpc,requireStripe:requireRideStripe,
   webhookReady:live=>!!Deno.env.get(live?'STRIPE_LIVE_WEBHOOK_SECRET':'STRIPE_WEBHOOK_API'),
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
