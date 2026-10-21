// Pure orchestration: transport, Stripe and database calls are injected for tests.
export const LIVE_RIDE_ACCOUNT = 'acct_1USiOkPYGWX41ye8';
export type RideOrder = { id:string; request_id:string; company_id:string; customer_id:string; account_id:string; amount_minor:number; currency:string; checkout_session_id:string|null; checkout_url:string|null; expires_at:number; state:string; livemode?:boolean };
type Row = Record<string,unknown>;
export const stripeObject = (value:unknown):Row => {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw Error('Invalid Stripe response');
 return value as Row;
};
const stripeId = (value:unknown,prefix:string) => {
 const candidate=typeof value==='object' && value ? stripeObject(value).id : value;
 if(typeof candidate!=='string' || !new RegExp(`^${prefix}_[a-zA-Z0-9]+$`).test(candidate)) throw Error('Invalid Stripe identity');
 return candidate;
};
const minor = (value:unknown):number => {
 if(!Number.isSafeInteger(value) || (value as number)<0 || (value as number)>100000000) throw Error('Invalid minor units');
 return value as number;
};
export type RideStripeSnapshot = {p_order_id:string;p_account_id:string;p_session_id:string;p_payment_id:string|null;p_event_id:string;p_state:'open'|'processing'|'canceled'|'paid';p_amount_minor:number;p_received_minor:number;p_refunded_minor:number};
export async function reconcileRideCheckout(order:RideOrder,eventId:string,deps:{
 retrieveSession:(id:string)=>Promise<unknown>;retrievePayment:(id:string)=>Promise<unknown>;record:(snapshot:RideStripeSnapshot)=>Promise<unknown>;
}) {
 const live=order.livemode!==false;
 if((live?order.account_id!==LIVE_RIDE_ACCOUNT:![LIVE_RIDE_ACCOUNT,'acct_1USiOtBXRX2hZ2VT'].includes(order.account_id)) || !order.checkout_session_id || !order.checkout_session_id.startsWith(live?'cs_live_':'cs_test_')) throw Error('Checkout registration pending');
 const session=stripeObject(await deps.retrieveSession(order.checkout_session_id));
 if(session.object!=='checkout.session' || session.id!==order.checkout_session_id || session.livemode!==live || session.mode!=='payment' ||
  session.amount_total!==order.amount_minor || session.currency!==order.currency || session.client_reference_id!==order.request_id ||
  stripeObject(session.metadata).leski_ride_order_id!==order.id) throw Error('Checkout binding rejected');
 let state:RideStripeSnapshot['p_state']='open', received=0,refunded=0,paymentId:string|null=null;
 if(session.payment_intent!=null) {
  paymentId=stripeId(session.payment_intent,'pi');
  const payment=stripeObject(await deps.retrievePayment(paymentId));
  if(payment.object!=='payment_intent' || payment.id!==paymentId || payment.livemode!==live || payment.amount!==order.amount_minor ||
   payment.currency!==order.currency || stripeObject(payment.metadata).leski_ride_order_id!==order.id) throw Error('Payment binding rejected');
  received=minor(payment.amount_received);
  if(received>order.amount_minor) throw Error('Invalid capture');
  if(payment.latest_charge!=null) {
   const charge=stripeObject(payment.latest_charge);
   if(charge.object!=='charge' || charge.payment_intent!==paymentId || charge.livemode!==live || charge.currency!==order.currency) throw Error('Charge binding rejected');
   refunded=minor(charge.amount_refunded);
   if(refunded>received)throw Error('Invalid refund');
  }
  if(payment.status==='succeeded') {
   if(received!==order.amount_minor || session.payment_status!=='paid' || session.status!=='complete')throw Error('Payment not fully captured');
   state='paid';
  } else if(payment.status==='processing' || payment.status==='requires_capture' || session.status==='complete') state='processing';
  else if(session.status==='expired' && received===0 && ['canceled','requires_payment_method','requires_confirmation'].includes(String(payment.status)))state='canceled';
  else if(session.status==='expired')state='processing'; // Uncertain authentication can never unlock cash.
 } else if(session.status==='expired')state='canceled';
 if(session.payment_status==='paid' && state!=='paid')throw Error('Checkout is not reconciled');
 return deps.record({p_order_id:order.id,p_account_id:order.account_id,p_session_id:order.checkout_session_id,p_payment_id:paymentId,
  p_event_id:eventId,p_state:state,p_amount_minor:order.amount_minor,p_received_minor:received,p_refunded_minor:refunded});
}
export function rideCheckoutParameters(order:RideOrder) {
 // All values come from a locked registered database order, never browser input.
 const metadata={leski_ride_order_id:order.id};
 const suffix=order.id.replace(/-/g,'').slice(-8).replace(/[0-9]/g,n=>String.fromCharCode(97+Number(n)));
 return {mode:'payment' as const,client_reference_id:order.request_id,metadata,payment_intent_data:{metadata},
  integration_identifier:`leski_ride_${suffix}`,adaptive_pricing:{enabled:false},expires_at:order.expires_at,
  line_items:[{quantity:1,price_data:{currency:order.currency,unit_amount:order.amount_minor,product_data:{name:order.livemode===false?'ТЕСТ · Пътуване с Лески Каручка':'Пътуване с Лески Каручка',description:`Курс ${order.request_id.slice(0,8)}`}}}],
  success_url:`https://leskikaruchka.com/customer/home?payment_return=${order.request_id}`,
  cancel_url:`https://leskikaruchka.com/customer/home?payment_return=${order.request_id}`};
}
export function createRideStripeWebhook(deps:{verify:(body:string,signature:string)=>Promise<unknown>;lookup:(id:string)=>Promise<RideOrder|null>;
 retrieveSession:(id:string)=>Promise<unknown>;retrievePayment:(id:string)=>Promise<unknown>;record:(snapshot:RideStripeSnapshot)=>Promise<unknown>;livemode?:boolean}) {
 const response=(status:number,result:string)=>new Response(JSON.stringify({result}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 return async (request:Request) => {
  if(request.method!=='POST')return response(405,'method_not_allowed');
  const signature=request.headers.get('stripe-signature');if(!signature)return response(400,'invalid_signature');
  let event:Row;
  try {const body=await request.text();if(body.length>1000000)return response(413,'payload_too_large');event=stripeObject(await deps.verify(body,signature));}
  catch{return response(400,'invalid_signature');}
  const live=deps.livemode!==false;
  if(event.livemode!==live || event.account!==undefined && (live?event.account!==LIVE_RIDE_ACCOUNT:![LIVE_RIDE_ACCOUNT,'acct_1USiOtBXRX2hZ2VT'].includes(String(event.account))))return response(400,'wrong_environment');
  if(typeof event.type!=='string' || !/^(checkout\.session\.(completed|expired|async_payment_succeeded|async_payment_failed)|payment_intent\.(succeeded|processing|payment_failed|canceled)|charge\.refunded|refund\.(created|updated|failed))$/.test(event.type))return response(200,'ignored');
  try {
   let value=stripeObject(stripeObject(event.data).object);
   if(event.type.startsWith('refund.') || event.type==='charge.refunded') {
    if(value.payment_intent==null)return response(200,'unrelated');
    value=stripeObject(await deps.retrievePayment(stripeId(value.payment_intent,'pi')));
   }
   const metadata=value.metadata==null?{}:stripeObject(value.metadata),orderId=metadata.leski_ride_order_id;
   if(typeof orderId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId))return response(200,'unrelated');
   const order=await deps.lookup(orderId);if(!order)return response(200,'unregistered');
   if((order.livemode!==false)!==live || event.account!==undefined && event.account!==order.account_id)return response(400,'wrong_environment');
   await reconcileRideCheckout(order,stripeId(event.id,'evt'),deps);
   return response(200,'recorded');
  }catch{return response(503,'reconciliation_pending');}
 };
}

