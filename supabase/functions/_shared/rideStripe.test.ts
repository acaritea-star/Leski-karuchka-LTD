import { beforeEach,expect,it,vi } from 'vitest';
import {createRideStripeWebhook,LIVE_RIDE_ACCOUNT,reconcileRideCheckout,rideCheckoutParameters,type RideOrder} from './rideStripe';
const order:RideOrder={id:'11111111-1111-4111-8111-111111111111',request_id:'22222222-2222-4222-8222-222222222222',company_id:'city',customer_id:'customer',account_id:LIVE_RIDE_ACCOUNT,amount_minor:295,currency:'eur',checkout_session_id:'cs_live_fixture',checkout_url:'https://checkout.stripe.com/c/pay/cs_live_fixture',expires_at:1800000000,state:'open'};
const session={id:'cs_live_fixture',object:'checkout.session',mode:'payment',livemode:true,amount_total:295,currency:'eur',client_reference_id:order.request_id,metadata:{leski_ride_order_id:order.id},payment_intent:'pi_fixture',status:'complete',payment_status:'paid'};
const payment={id:'pi_fixture',object:'payment_intent',livemode:true,amount:295,amount_received:295,currency:'eur',metadata:{leski_ride_order_id:order.id},status:'succeeded',latest_charge:{object:'charge',livemode:true,payment_intent:'pi_fixture',currency:'eur',amount_refunded:0}};
const deps={retrieveSession:vi.fn(),retrievePayment:vi.fn(),record:vi.fn(),verify:vi.fn(),lookup:vi.fn()};
beforeEach(()=>{vi.resetAllMocks();deps.retrieveSession.mockResolvedValue(session);deps.retrievePayment.mockResolvedValue(payment);deps.record.mockResolvedValue({state:'paid'});deps.lookup.mockResolvedValue(order);});
it('creates one deterministic hosted EUR checkout, with no browser-controlled amount or redirect and no frontend SDK',()=>{
 const params=rideCheckoutParameters(order);expect(params).toEqual(rideCheckoutParameters(order));
 expect(params.line_items[0].price_data.unit_amount).toBe(295);expect(params.success_url).toBe('https://leskikaruchka.com/customer/home?payment_return='+order.request_id);
 expect(params).not.toHaveProperty('payment_method_types');expect(params.adaptive_pricing.enabled).toBe(false);expect(params.payment_intent_data.metadata).toEqual(params.metadata);
});
it('binds the server-created session, underlying payment, live account, customer ride and exact minor units before settlement',async()=>{
 await reconcileRideCheckout(order,'evt_fixture',deps);expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({p_order_id:order.id,p_payment_id:'pi_fixture',p_state:'paid',p_received_minor:295,p_refunded_minor:0}));
});
it.each([{livemode:false},{amount_total:296},{currency:'usd'},{client_reference_id:'another'},{metadata:{leski_ride_order_id:'another'}},{id:'cs_live_other'}])('rejects a checkout binding mismatch %j',async fields=>{
 deps.retrieveSession.mockResolvedValue({...session,...fields});await expect(reconcileRideCheckout(order,'evt_fixture',deps)).rejects.toThrow();expect(deps.record).not.toHaveBeenCalled();
});
it.each([{livemode:false},{amount:296},{amount_received:200},{currency:'usd'},{metadata:{leski_ride_order_id:'another'}},{id:'pi_other'}])('rejects a payment binding mismatch or partial capture %j',async fields=>{
 deps.retrievePayment.mockResolvedValue({...payment,...fields});await expect(reconcileRideCheckout(order,'evt_fixture',deps)).rejects.toThrow();expect(deps.record).not.toHaveBeenCalled();
});
it('never unlocks cash for a processing or unresolved completed payment',async()=>{
 deps.retrieveSession.mockResolvedValue({...session,payment_status:'unpaid'});deps.retrievePayment.mockResolvedValue({...payment,status:'processing',amount_received:0,latest_charge:null});
 await reconcileRideCheckout(order,'evt_fixture',deps);expect(deps.record).toHaveBeenLastCalledWith(expect.objectContaining({p_state:'processing'}));
 deps.retrieveSession.mockResolvedValue({...session,status:'expired',payment_status:'unpaid'});deps.retrievePayment.mockResolvedValue({...payment,status:'requires_action',amount_received:0,latest_charge:null});
 await reconcileRideCheckout(order,'evt_fixture',deps);expect(deps.record).toHaveBeenLastCalledWith(expect.objectContaining({p_state:'processing'}));
});
it('unlocks cash only after Stripe confirms the checkout expired without receiving money',async()=>{
 deps.retrieveSession.mockResolvedValue({...session,status:'expired',payment_status:'unpaid'});deps.retrievePayment.mockResolvedValue({...payment,status:'requires_payment_method',amount_received:0,latest_charge:null});
 await reconcileRideCheckout(order,'evt_fixture',deps);expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({p_state:'canceled',p_received_minor:0}));
});
it('reconciles current refund totals from the expanded charge',async()=>{
 deps.retrievePayment.mockResolvedValue({...payment,latest_charge:{...payment.latest_charge,amount_refunded:95}});await reconcileRideCheckout(order,'evt_refund',deps);
 expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({p_state:'paid',p_received_minor:295,p_refunded_minor:95}));
});
const call=()=>createRideStripeWebhook(deps)(new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':'signature'},body:'raw-payload'}));
it('requires the signature over raw bytes, rejects sandbox events, and retries storage failure',async()=>{
 deps.verify.mockRejectedValueOnce(Error('invalid'));expect((await call()).status).toBe(400);expect(deps.lookup).not.toHaveBeenCalled();
 deps.verify.mockResolvedValue({id:'evt_fixture',type:'checkout.session.completed',livemode:false,data:{object:session}});expect((await call()).status).toBe(400);
 deps.verify.mockResolvedValue({id:'evt_fixture',type:'checkout.session.completed',livemode:true,data:{object:session}});deps.record.mockRejectedValueOnce(Error('offline'));expect((await call()).status).toBe(503);
 expect((await call()).status).toBe(200);expect(deps.verify).toHaveBeenCalledWith('raw-payload','signature');
});
it('retries a webhook received before the checkout attachment and ignores unrelated signed payments',async()=>{
 deps.verify.mockResolvedValue({id:'evt_fixture',type:'checkout.session.completed',livemode:true,data:{object:session}});deps.lookup.mockResolvedValueOnce({...order,checkout_session_id:null});expect((await call()).status).toBe(503);
 deps.lookup.mockResolvedValueOnce(null);expect((await call()).status).toBe(200);expect(deps.record).not.toHaveBeenCalled();
});


it.each(['acct_1USiOkPYGWX41ye8','acct_1USiOtBXRX2hZ2VT'])('reconciles an explicitly registered test order for %s without accepting live objects',async account=>{
 const testOrder={...order,account_id:account,livemode:false,checkout_session_id:'cs_test_fixture'};
 const testSession={...session,id:'cs_test_fixture',livemode:false};
 const testPayment={...payment,livemode:false,latest_charge:{...payment.latest_charge,livemode:false}};
 deps.lookup.mockResolvedValue(testOrder);deps.retrieveSession.mockResolvedValue(testSession);deps.retrievePayment.mockResolvedValue(testPayment);
 await reconcileRideCheckout(testOrder,'evt_test',deps);
 expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({p_account_id:account,p_state:'paid'}));
 deps.verify.mockResolvedValue({id:'evt_test',account,type:'checkout.session.completed',livemode:false,data:{object:testSession}});
 const handler=createRideStripeWebhook({...deps,livemode:false});
 expect((await handler(new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':'signed'},body:'raw'}))).status).toBe(200);
 deps.retrievePayment.mockResolvedValue(payment);
 await expect(reconcileRideCheckout(testOrder,'evt_wrong',deps)).rejects.toThrow();
});
it('a test webhook cannot settle a registered live order even on the same account',async()=>{
 deps.verify.mockResolvedValue({id:'evt_test',type:'checkout.session.completed',livemode:false,data:{object:session}});
 const handler=createRideStripeWebhook({...deps,livemode:false});
 expect((await handler(new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':'signed'},body:'raw'}))).status).toBe(400);
 expect(deps.record).not.toHaveBeenCalled();
});
