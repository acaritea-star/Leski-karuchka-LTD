import { beforeEach,expect,it,vi } from 'vitest';
import { runRideCheckout,type RideCheckoutDeps } from './rideCheckout';
import { LIVE_RIDE_ACCOUNT,reconcileRideCheckout,rideCheckoutParameters,type RideOrder } from './rideStripe';
const order:RideOrder={id:'11111111-1111-4111-8111-111111111111',request_id:'22222222-2222-4222-8222-222222222222',company_id:'city',customer_id:'customer',account_id:LIVE_RIDE_ACCOUNT,amount_minor:295,currency:'eur',checkout_session_id:null,checkout_url:null,expires_at:1800000000,state:'creating',livemode:false,ui_mode:'elements',stripe_customer_id:null};
const session=()=>({object:'checkout.session',id:'cs_test_inline',livemode:false,mode:'payment',ui_mode:'elements',customer:'cus_inline',amount_total:295,currency:'eur',client_reference_id:order.request_id,metadata:{leski_ride_order_id:order.id},status:'open',payment_status:'unpaid',payment_intent:null,client_secret:'cs_test_inline_secret_fixture',url:null});
let saved:RideOrder;const rpc=vi.fn(),createCustomer=vi.fn(),createSession=vi.fn(),retrieveSession=vi.fn(),retrievePayment=vi.fn(),expireSession=vi.fn();
const deps:RideCheckoutDeps={rpc,createCustomer,createSession,retrieveSession,retrievePayment,expireSession,requireStripe:async()=>LIVE_RIDE_ACCOUNT,webhookReady:()=>true};
beforeEach(()=>{
 vi.resetAllMocks();saved={...order};
 createCustomer.mockResolvedValue({id:'cus_inline'});createSession.mockResolvedValue(session());retrieveSession.mockResolvedValue(session());
 rpc.mockImplementation(async(name,args)=>{
  if(name==='ride_checkout_merchant')return {account_id:LIVE_RIDE_ACCOUNT,livemode:false,publishable_key:'pk_test_fixture'};
  if(name==='ride_stripe_customer_context')return {email:'stripe-test@example.invalid'};
  if(name==='bind_ride_stripe_customer')saved={...saved,stripe_customer_id:args.p_stripe_customer_id};
  if(name==='attach_ride_checkout')saved={...saved,checkout_session_id:args.p_session_id,checkout_url:args.p_url,state:'open'};
  if(name==='record_ride_stripe_snapshot')return {state:args.p_state};
  return {...saved};
 });
});
it('creates one owner-bound Session using the frozen fare, without an extra Stripe read before display',async()=>{
 const result=await runRideCheckout('customer',order.request_id,'elements',deps);
 expect(result).toMatchObject({state:'open',environment:'test',client_secret:'cs_test_inline_secret_fixture',amount_minor:295,account_id:LIVE_RIDE_ACCOUNT});
 expect(createCustomer).toHaveBeenCalledWith(false,'stripe-test@example.invalid',`leski-customer-${LIVE_RIDE_ACCOUNT}-test-customer`);
 expect(createSession).toHaveBeenCalledWith(false,expect.objectContaining({ui_mode:'elements',customer:'cus_inline',allowed_payment_method_types:['card']}),`leski-ride-${order.id}`);
 expect(retrieveSession).not.toHaveBeenCalled();expect(rpc.mock.calls.some(([name])=>name==='record_ride_stripe_snapshot')).toBe(false);
 await runRideCheckout('customer',order.request_id,'elements',deps);
 expect(createSession).toHaveBeenCalledTimes(1);expect(createCustomer).toHaveBeenCalledTimes(1);expect(retrieveSession).toHaveBeenCalledTimes(1);
});
it('reuses the same customer creation key after a database/network failure',async()=>{
 const fn=rpc.getMockImplementation()!;let first=true;rpc.mockImplementation(async(name,args)=>{if(name==='bind_ride_stripe_customer'&&first){first=false;throw Error('offline');}return fn(name,args);});
 await expect(runRideCheckout('customer',order.request_id,'elements',deps)).rejects.toThrow('offline');
 await runRideCheckout('customer',order.request_id,'elements',deps);
 expect(createCustomer.mock.calls[0]).toEqual(createCustomer.mock.calls[1]);expect(createSession).toHaveBeenCalledTimes(1);
});
it('preserves a started hosted Checkout instead of creating a second payment',async()=>{
 saved={...order,ui_mode:'hosted',checkout_session_id:'cs_test_inline',checkout_url:'https://checkout.stripe.com/c/pay/cs_test_inline',state:'open'};
 const result=await runRideCheckout('customer',order.request_id,'elements',deps);
 expect(result.url).toBe(saved.checkout_url);expect(result).not.toHaveProperty('client_secret');expect(createSession).not.toHaveBeenCalled();
});
it('never returns payment secrets or saved cards to a driver reconciliation',async()=>{
 saved={...order,stripe_customer_id:'cus_inline',checkout_session_id:'cs_test_inline',state:'open'};
 expect(await runRideCheckout('driver',order.request_id,'reconcile',deps)).not.toHaveProperty('client_secret');
 await expect(runRideCheckout('driver',order.request_id,'elements',deps)).rejects.toThrow('Customer required');
});
it.each([{customer:'cus_foreign'},{ui_mode:'hosted'},{amount_total:300},{livemode:true},{client_reference_id:'foreign'}])('rejects foreign binding %j before attachment',async mutation=>{
 createSession.mockResolvedValue({...session(),...mutation});await expect(runRideCheckout('customer',order.request_id,'elements',deps)).rejects.toThrow();
 expect(rpc.mock.calls.some(([name])=>name==='attach_ride_checkout')).toBe(false);
});
it('requires matching publishable-key mode before returning a client secret',async()=>{
 const fn=rpc.getMockImplementation()!;rpc.mockImplementation((name,args)=>name==='ride_checkout_merchant'?{account_id:LIVE_RIDE_ACCOUNT,livemode:false,publishable_key:'pk_live_wrong'}:fn(name,args));
 await expect(runRideCheckout('customer',order.request_id,'elements',deps)).rejects.toThrow('configuration');
});
it('expires and reconciles before declaring a cash switch safe',async()=>{
 saved={...order,stripe_customer_id:'cus_inline',checkout_session_id:'cs_test_inline',state:'open'};
 expireSession.mockRejectedValue(Error('payment concurrent'));retrieveSession.mockResolvedValue({...session(),status:'complete',payment_intent:'pi_inline'});
 retrievePayment.mockResolvedValue({object:'payment_intent',id:'pi_inline',livemode:false,amount:295,amount_received:0,currency:'eur',customer:'cus_inline',metadata:{leski_ride_order_id:order.id},status:'processing',latest_charge:null});
 expect(await runRideCheckout('customer',order.request_id,'cancel',deps)).toMatchObject({state:'processing',url:null});
});
it('uses explicit Stripe save consent and no off-session automatic card saving',()=>{
 const params=rideCheckoutParameters({...order,stripe_customer_id:'cus_inline'});
 expect(params).toMatchObject({saved_payment_method_options:{payment_method_save:'enabled',payment_method_remove:'enabled'}});
 expect(params).not.toHaveProperty('success_url');expect(params.payment_intent_data).not.toHaveProperty('setup_future_usage');
});
it('rejects a foreign PaymentIntent customer before settlement',async()=>{
 const record=vi.fn();await expect(reconcileRideCheckout({...order,stripe_customer_id:'cus_inline',checkout_session_id:'cs_test_inline'},'evt_test',{
  retrieveSession:async()=>({...session(),status:'complete',payment_status:'paid',payment_intent:'pi_inline'}),
  retrievePayment:async()=>({object:'payment_intent',id:'pi_inline',livemode:false,amount:295,amount_received:295,currency:'eur',customer:'cus_other',metadata:{leski_ride_order_id:order.id},status:'succeeded'}),record,
 })).rejects.toThrow('Payment binding');expect(record).not.toHaveBeenCalled();
});
