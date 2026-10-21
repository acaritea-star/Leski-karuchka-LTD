import { authorize,cors,json } from '../_shared/auth.ts';
import { reconcileRideCheckout,rideCheckoutParameters,type RideOrder } from '../_shared/rideStripe.ts';
import { paymentRpc,requireRideStripe,stripeForRide,rideStripeDependenciesForMode } from '../_shared/rideStripeRuntime.ts';
export async function rideCheckout(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
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
  if(!['checkout','cancel','reconcile'].includes(input.action??'') || typeof input.request_id!=='string' || !/^[0-9a-f-]{36}$/i.test(input.request_id))return json({code:'INVALID_REQUEST'},400);
  let order:RideOrder|null;
  if(input.action==='checkout') {
   const merchant=await paymentRpc('ride_checkout_merchant',{p_request_id:input.request_id,p_actor:actor.id}) as {account_id:string;livemode:boolean};
   if(await requireRideStripe(merchant.livemode,true)!==merchant.account_id)throw Error('Merchant key mismatch');
   if(!Deno.env.get(merchant.livemode?'STRIPE_LIVE_WEBHOOK_SECRET':'STRIPE_WEBHOOK_API'))return json({code:'ONLINE_UNAVAILABLE'},503);
   order=await paymentRpc('begin_ride_checkout',{p_request_id:input.request_id,p_actor:actor.id,p_account_id:merchant.account_id}) as RideOrder;
  }else order=await paymentRpc('read_ride_checkout',{p_request_id:input.request_id,p_actor:actor.id}) as RideOrder|null;
  if(!order)return json({state:'none'});
  const live=order.livemode!==false;
  if(await requireRideStripe(live)!==order.account_id)throw Error('Checkout account mismatch');
  const stripe=stripeForRide(live);
  if(!order.checkout_session_id) {
   const session=await stripe.checkout.sessions.create(rideCheckoutParameters(order),{idempotencyKey:`leski-ride-${order.id}`});
   if(session.livemode!==live || !session.url || !session.id.startsWith(live?'cs_live_':'cs_test_'))throw Error('Invalid Checkout environment');
   order=await paymentRpc('attach_ride_checkout',{p_order_id:order.id,p_session_id:session.id,p_url:session.url}) as RideOrder;
  }
  if(input.action==='cancel') {
   try{await stripe.checkout.sessions.expire(order.checkout_session_id!);}
   catch { /* A concurrent payment may have completed; reconcile its actual state. */ }
  }
  const result=await reconcileRideCheckout(order,`sync:${order.checkout_session_id}:${crypto.randomUUID()}`,rideStripeDependenciesForMode(live)) as {state?:string};
  return new Response(JSON.stringify({state:result.state,environment:live?'live':'test',url:input.action==='checkout' && result.state==='open'?order.checkout_url:null}),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch(error) {
  if(error instanceof Response)return error;
  const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
  return json({code:code==='42501'?'PAYMENT_NOT_ALLOWED':'PAYMENT_CHECK_PENDING'},code==='42501'?403:503);
 }
}
Deno.serve(rideCheckout);
