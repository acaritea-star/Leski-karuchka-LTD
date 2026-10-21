import { authorize,cors,json } from '../_shared/auth.ts';
import { LIVE_RIDE_ACCOUNT,reconcileRideCheckout,rideCheckoutParameters,type RideOrder } from '../_shared/rideStripe.ts';
import { paymentRpc,requireRideStripe,rideStripe,rideStripeDependencies } from '../_shared/rideStripeRuntime.ts';
export async function rideCheckout(request:Request):Promise<Response> {
 if(request.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);
 try {
  const actor=await authorize(request);
  const body=await request.text();if(body.length>2000)return json({code:'INVALID_REQUEST'},400);
  const input=JSON.parse(body) as {action?:string;request_id?:string};
  if(input.action==='readiness' && actor.role==='SUPER_ADMIN') {
   try{await requireRideStripe();return json({ready:true,account_id:LIVE_RIDE_ACCOUNT,webhook_secret_configured:!!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')});}
   catch{return json({ready:false,account_id:LIVE_RIDE_ACCOUNT,webhook_secret_configured:!!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET')});}
  }
  if(!['checkout','cancel','reconcile'].includes(input.action??'') || typeof input.request_id!=='string' || !/^[0-9a-f-]{36}$/i.test(input.request_id))return json({code:'INVALID_REQUEST'},400);
  await requireRideStripe();
  if(!Deno.env.get('STRIPE_LIVE_WEBHOOK_SECRET'))return json({code:'ONLINE_UNAVAILABLE'},503);
  let order:RideOrder|null;
  if(input.action==='checkout') {
   order=await paymentRpc('begin_ride_checkout',{p_request_id:input.request_id,p_actor:actor.id,p_account_id:LIVE_RIDE_ACCOUNT}) as RideOrder;
   if(!order.checkout_session_id){
    const session=await rideStripe.checkout.sessions.create(rideCheckoutParameters(order),{idempotencyKey:`leski-ride-${order.id}`});
    if(session.livemode!==true || !session.url || !session.id.startsWith('cs_live_'))throw Error('Invalid Checkout environment');
    order=await paymentRpc('attach_ride_checkout',{p_order_id:order.id,p_session_id:session.id,p_url:session.url}) as RideOrder;
   }
  }else order=await paymentRpc('read_ride_checkout',{p_request_id:input.request_id,p_actor:actor.id}) as RideOrder|null;
  if(!order)return json({state:'none'});
  if(!order.checkout_session_id) {
   // Recover a lost create response with the exact same deterministic command.
   const session=await rideStripe.checkout.sessions.create(rideCheckoutParameters(order),{idempotencyKey:`leski-ride-${order.id}`});
   if(session.livemode!==true || !session.url || !session.id.startsWith('cs_live_'))throw Error('Invalid Checkout environment');
   order=await paymentRpc('attach_ride_checkout',{p_order_id:order.id,p_session_id:session.id,p_url:session.url}) as RideOrder;
  }
  if(input.action==='cancel') {
   try{await rideStripe.checkout.sessions.expire(order.checkout_session_id!);}
   catch { /* A concurrent payment may have completed; reconcile before cash. */ }
  }
  const result=await reconcileRideCheckout(order,`sync:${order.checkout_session_id}:${crypto.randomUUID()}`,rideStripeDependencies) as {state?:string};
  return new Response(JSON.stringify({state:result.state,url:input.action==='checkout' && result.state==='open'?order.checkout_url:null}),{headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 }catch(error) {
  if(error instanceof Response)return error;
  const code=error && typeof error==='object' && 'code' in error?String(error.code):'';
  return json({code:code==='42501'?'PAYMENT_NOT_ALLOWED':'PAYMENT_CHECK_PENDING'},code==='42501'?403:503);
 }
}
Deno.serve(rideCheckout);
