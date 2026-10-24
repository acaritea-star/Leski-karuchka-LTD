import { reconcileRideCheckout,rideCheckoutParameters,validateRideSession,type RideOrder } from './rideStripe.ts';
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type RideCheckoutDeps={
 rpc:Rpc;requireStripe:(live:boolean,charges?:boolean)=>Promise<string>;webhookReady:(live:boolean)=>boolean;
 createCustomer:(live:boolean,email:string|null,key:string)=>Promise<{id:string}>;
 createSession:(live:boolean,params:ReturnType<typeof rideCheckoutParameters>,key:string)=>Promise<unknown>;
 retrieveSession:(live:boolean,id:string)=>Promise<unknown>;retrievePayment:(live:boolean,id:string)=>Promise<unknown>;
 expireSession:(live:boolean,id:string)=>Promise<unknown>;
};
// Auth and API budgets are enforced by the HTTP adapter; every RPC rechecks the actor's scope.
export async function runRideCheckout(actor:string,requestId:string,action:'checkout'|'elements'|'cancel'|'reconcile',deps:RideCheckoutDeps) {
 let order:RideOrder|null,merchant:{account_id:string;livemode:boolean;publishable_key?:string|null}|undefined;
 if(action==='checkout'||action==='elements') {
  merchant=await deps.rpc('ride_checkout_merchant',{p_request_id:requestId,p_actor:actor}) as typeof merchant;
  if(!merchant || await deps.requireStripe(merchant.livemode,true)!==merchant.account_id || !deps.webhookReady(merchant.livemode))throw Error('Online merchant unavailable');
  order=await deps.rpc(action==='elements'?'begin_ride_elements_checkout':'begin_ride_checkout',{p_request_id:requestId,p_actor:actor,p_account_id:merchant.account_id}) as RideOrder;
 }else order=await deps.rpc('read_ride_checkout',{p_request_id:requestId,p_actor:actor}) as RideOrder|null;
 if(!order)return {state:'none'};
 const live=order.livemode!==false;
 if(order.request_id!==requestId)throw Error('Checkout account mismatch');
 // Explicit reconciliation also recovers a refund whose webhook was missed.
 // The client avoids this path when it already has the verified receipt.
 if(await deps.requireStripe(live)!==order.account_id)throw Error('Checkout account mismatch');
 if(action==='elements' && actor!==order.customer_id)throw Error('Customer required');
 let session:Record<string,unknown>|undefined;
 if(!order.checkout_session_id && order.state!=='canceled') {
  if(order.ui_mode==='elements'&&!order.stripe_customer_id) {
   // Drivers can reconcile an attached Session; only the owner can initialise saved-card access.
   if(actor!==order.customer_id) return {state:order.state,environment:live?'live':'test'};
   const context=await deps.rpc('ride_stripe_customer_context',{p_order_id:order.id,p_actor:actor}) as {email:string|null};
   const customer=await deps.createCustomer(live,context.email,`leski-customer-${order.account_id}-${live?'live':'test'}-${actor}`);
   if(!/^cus_[a-zA-Z0-9]+$/.test(customer.id))throw Error('Invalid customer');
   order=await deps.rpc('bind_ride_stripe_customer',{p_order_id:order.id,p_actor:actor,p_stripe_customer_id:customer.id}) as RideOrder;
  }
  session=validateRideSession(order,await deps.createSession(live,rideCheckoutParameters(order),`leski-ride-${order.id}`));
  if(order.ui_mode!=='elements' && (typeof session.url!=='string'||!session.url.startsWith('https://checkout.stripe.com/')))throw Error('Invalid checkout URL');
  order=await deps.rpc('attach_ride_checkout',{p_order_id:order.id,p_session_id:session.id,p_url:order.ui_mode==='elements'?null:session.url}) as RideOrder;
 }
 if(!order.checkout_session_id)return {state:order.state,environment:live?'live':'test'};
 if(action==='cancel') {
  try{await deps.expireSession(live,order.checkout_session_id);}catch { /* Reconcile concurrent completion before cash can unlock. */ }
  session=undefined;
 }
 let state=order.state;
 // A newly created unpaid Session is already verified. Avoid a redundant Stripe GET before rendering.
 if(!session || session.status!=='open' || session.payment_status!=='unpaid') {
  session=validateRideSession(order,await deps.retrieveSession(live,order.checkout_session_id));
  const result=await reconcileRideCheckout(order,`sync:${order.checkout_session_id}:${crypto.randomUUID()}`,{
   retrieveSession:async()=>session!,retrievePayment:id=>deps.retrievePayment(live,id),
   record:snapshot=>deps.rpc('record_ride_stripe_snapshot',snapshot as unknown as Record<string,unknown>),
  }) as {state:string};state=result.state;
 }
 const result={state,environment:live?'live':'test',url:(action==='checkout'||action==='elements')&&state==='open'?order.checkout_url:null};
 if(action!=='elements'||state!=='open'||order.ui_mode!=='elements')return result;
 if(!merchant?.publishable_key || !(live?/^pk_live_[a-zA-Z0-9]+$/:/^pk_test_[a-zA-Z0-9]+$/).test(merchant.publishable_key) ||
  typeof session.client_secret!=='string'||!session.client_secret.startsWith(`${order.checkout_session_id}_secret_`))throw Error('Invalid payment configuration');
 return {...result,ui_mode:'elements',request_id:requestId,session_id:order.checkout_session_id,account_id:order.account_id,
  amount_minor:order.amount_minor,currency:order.currency,publishable_key:merchant.publishable_key,client_secret:session.client_secret};
}
