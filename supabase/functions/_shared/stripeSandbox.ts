// This handler deliberately has no production ride/payment write path.
export const SANDBOX_ACCOUNT = 'acct_1USiOtBXRX2hZ2VT';
type ObjectRow = Record<string, unknown>;
type Normalized = {
 account_id: string; event_id: string; type: string; livemode: false;
 payment_id: string; checkout_session_id: string | null; order_id: string | null; amount_minor: number;
 received_minor: number; refunded_minor: number; currency: string;
 state: 'pending' | 'processing' | 'failed' | 'canceled' | 'paid';
};
type Dependencies = {
 verify: (body: string, signature: string) => Promise<unknown>;
 retrievePayment: (id: string) => Promise<unknown>;
 record: (event: Normalized) => Promise<{ data: unknown; error: unknown }>;
};
const object = (value: unknown): ObjectRow => {
 if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Stripe object');
 return value as ObjectRow;
};
const id = (value: unknown, prefix: string): string => {
 if (typeof value !== 'string' || !new RegExp(`^${prefix}_[a-zA-Z0-9]+$`).test(value)) throw Error('Invalid Stripe ID');
 return value;
};
const minor = (value: unknown): number => {
 if (!Number.isSafeInteger(value) || (value as number)<0 || (value as number)>100_000_000) throw Error('Invalid minor units');
 return value as number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supported = new Set(['payment_intent.succeeded','payment_intent.processing','payment_intent.payment_failed','payment_intent.canceled',
 'payment_intent.created','payment_intent.requires_action','payment_intent.amount_capturable_updated','payment_intent.partially_funded',
 'refund.created','refund.updated','refund.failed','charge.refunded',
 'checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']);
const reply = (status: number, result: string) => new Response(JSON.stringify({ result }), {
 status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export function createStripeSandboxHandler(deps: Dependencies) {
 return async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return reply(405,'method_not_allowed');
  const signature = request.headers.get('stripe-signature');
  if (!signature) return reply(400,'invalid_signature');
  let event: ObjectRow;
  try {
   const body = await request.text();
   if (body.length>1_000_000) return reply(413,'payload_too_large');
   // Verify the exact raw bytes before parsing or acting on any metadata.
   event = object(await deps.verify(body,signature));
  } catch { return reply(400,'invalid_signature'); }
  if (event.livemode !== false || event.account !== undefined && event.account !== SANDBOX_ACCOUNT) return reply(400,'wrong_stripe_environment');
  if (typeof event.type !== 'string' || !supported.has(event.type)) return reply(200,'ignored_event_type');
  let normalized: Normalized;
  try {
   let payment = object(object(event.data).object);
   let checkoutSessionId: string | null = null;
   if (event.type.startsWith('checkout.session.')) {
    const session = payment;
    if (session.object!=='checkout.session' || session.livemode!==false || session.mode!=='payment') return reply(400,'wrong_checkout_environment');
    if (typeof session.id!=='string' || !/^cs_test_[a-zA-Z0-9]+$/.test(session.id)) throw Error('Invalid checkout ID');
    checkoutSessionId = session.id;
    const paymentId = typeof session.payment_intent==='object' && session.payment_intent ? object(session.payment_intent).id : session.payment_intent;
    if (paymentId == null) return reply(200,'ignored_unrelated_checkout');
    try { payment = object(await deps.retrievePayment(id(paymentId,'pi'))); }
    catch { return reply(503,'stripe_reconciliation_unavailable'); }
    if (payment.id!==paymentId) throw Error('Wrong Checkout payment');
    const metadata = session.metadata == null ? {} : object(session.metadata);
    if (session.amount_total!==payment.amount || session.currency!==payment.currency ||
     metadata.leski_payment_order_id!==object(payment.metadata).leski_payment_order_id) throw Error('Invalid checkout binding');
   }
   const refundEvent = event.type.startsWith('refund.') || event.type==='charge.refunded';
   if (refundEvent) {
    const paymentId = typeof payment.payment_intent==='object' && payment.payment_intent ? object(payment.payment_intent).id : payment.payment_intent;
    // Some unrelated refunds are not linked to a PaymentIntent.
    if (paymentId == null) return reply(200,'ignored_unrelated_refund');
    try { payment = object(await deps.retrievePayment(id(paymentId,'pi'))); }
    catch { return reply(503,'stripe_reconciliation_unavailable'); }
    if (payment.id!==paymentId) throw Error('Wrong refund payment');
   }
   if (payment.object!=='payment_intent' || payment.livemode!==false) return reply(400,'wrong_payment_environment');
   const paymentId = id(payment.id,'pi');
   const metadata = payment.metadata == null ? {} : object(payment.metadata);
   const orderId = typeof metadata.leski_payment_order_id==='string' && uuid.test(metadata.leski_payment_order_id) ? metadata.leski_payment_order_id : null;
   const amount = minor(payment.amount), received = minor(payment.amount_received);
   let refunded = 0;
   if (refundEvent) {
    const charge = object(payment.latest_charge);
    if (charge.object!=='charge' || charge.livemode!==false || charge.payment_intent!==paymentId || charge.currency!==payment.currency) throw Error('Invalid charge binding');
    refunded = minor(charge.amount_refunded);
   }
   if (amount===0 || received>amount || refunded>received || typeof payment.currency!=='string' || !/^[a-z]{3}$/.test(payment.currency)) throw Error('Invalid payment amount');
   const states: Record<string, Normalized['state']> = {succeeded:'paid',processing:'processing',canceled:'canceled',requires_payment_method:'failed',requires_action:'pending',requires_confirmation:'pending',requires_capture:'pending'};
   const state = typeof payment.status==='string' ? states[payment.status] : undefined;
   if (!state || state==='paid' && received!==amount) throw Error('Payment is not fully captured');
   normalized = {account_id:SANDBOX_ACCOUNT,event_id:id(event.id,'evt'),type:event.type,livemode:false,payment_id:paymentId,checkout_session_id:checkoutSessionId,
    order_id:orderId,amount_minor:amount,received_minor:received,refunded_minor:refunded,currency:payment.currency,state};
  } catch { return reply(400,'invalid_payment_event'); }
  try {
   const { data, error } = await deps.record(normalized);
   if (error) return reply(503,'payment_storage_unavailable');
   const result = object(data).result;
   if (typeof result!=='string' || !['applied_sandbox_only','ignored_unregistered_payment','rejected_company','rejected_amount_or_currency'].includes(result)) return reply(503,'invalid_storage_confirmation');
   return reply(200,result);
  } catch { return reply(503,'payment_storage_unavailable'); }
 };
}
