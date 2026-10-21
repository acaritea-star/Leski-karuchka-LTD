import { beforeEach, expect, it, vi } from 'vitest';
import { createStripeSandboxHandler, SANDBOX_ACCOUNT } from './stripeSandbox';

const order = '11111111-1111-4111-8111-111111111111';
const payment = {object:'payment_intent',id:'pi_fixture',livemode:false,amount:1234,amount_received:1234,currency:'eur',status:'succeeded',metadata:{leski_payment_order_id:order,ride_id:'untrusted',driver_id:'untrusted',company_id:'untrusted'}};
const event = {object:'event',id:'evt_fixture',type:'payment_intent.succeeded',livemode:false,data:{object:payment}};
const verify = vi.fn(), retrievePayment = vi.fn(), record = vi.fn();
const handler = createStripeSandboxHandler({verify,retrievePayment,record});
const call = (headers: Record<string,string> = {'stripe-signature':'signed'}, body = 'exact raw body') => handler(new Request('https://example.invalid/stripe-webhook',{method:'POST',headers,body}));
beforeEach(() => {
 vi.resetAllMocks(); verify.mockResolvedValue(structuredClone(event));
 record.mockResolvedValue({data:{result:'applied_sandbox_only'},error:null});
});
it('verifies the raw payload before writing, uses minor units and discards ride/driver/company metadata',async()=>{
 expect((await call()).status).toBe(200);
 expect(verify).toHaveBeenCalledExactlyOnceWith('exact raw body','signed');
 expect(record).toHaveBeenCalledExactlyOnceWith({account_id:SANDBOX_ACCOUNT,event_id:'evt_fixture',type:'payment_intent.succeeded',livemode:false,
  payment_id:'pi_fixture',checkout_session_id:null,order_id:order,amount_minor:1234,received_minor:1234,refunded_minor:0,currency:'eur',state:'paid'});
 expect(verify.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
});
it('rejects unsigned, invalid and oversized payloads without calling the database',async()=>{
 expect((await call({})).status).toBe(400);
 verify.mockRejectedValueOnce(Error('Bad signature'));
 expect((await call()).status).toBe(400);
 expect((await call({'stripe-signature':'signed'},'x'.repeat(1_000_001))).status).toBe(413);
 expect(record).not.toHaveBeenCalled();
});
it.each([
 {...event,livemode:true}, {...event,account:'acct_foreign'}, {...event,livemode:undefined},
 {...event,data:{object:{...payment,livemode:true}}},
])('refuses the live environment and foreign accounts even with a valid signature',async value=>{
 verify.mockResolvedValue(value);
 expect((await call()).status).toBe(400); expect(record).not.toHaveBeenCalled();
});
it.each([
 {amount:12.34}, {amount_received:1200}, {amount_received:1235}, {amount:0,amount_received:0},
 {currency:'EUR'}, {amount:Number.MAX_SAFE_INTEGER+1}, {status:'unexpected'},
])('never accepts a partial capture or invalid amount as fully paid',async fields=>{
 verify.mockResolvedValue({...event,data:{object:{...payment,...fields}}});
 expect((await call()).status).toBe(400);expect(record).not.toHaveBeenCalled();
});
it('treats an authorization as pending, not paid',async()=>{
 verify.mockResolvedValue({...event,type:'payment_intent.amount_capturable_updated',data:{object:{...payment,status:'requires_capture',amount_received:0}}});
 expect((await call()).status).toBe(200);expect(record).toHaveBeenCalledWith(expect.objectContaining({state:'pending',received_minor:0}));
});
it('safely acknowledges old CLI fixtures with missing or fabricated metadata as unregistered',async()=>{
 record.mockResolvedValue({data:{result:'ignored_unregistered_payment'},error:null});
 verify.mockResolvedValue({...event,data:{object:{...payment,metadata:{ride_id:'11111111-1111-1111-1111-111111111111'}}}});
 const response=await call();expect(response.status).toBe(200);
 expect(await response.json()).toEqual({result:'ignored_unregistered_payment'});
 expect(record).toHaveBeenCalledWith(expect.objectContaining({order_id:null}));
});
it('retries database failures instead of acknowledging an unrecorded payment',async()=>{
 record.mockResolvedValue({data:null,error:{message:'private database detail'}});
 const response=await call();expect(response.status).toBe(503);expect(await response.text()).not.toContain('private database detail');
 record.mockRejectedValueOnce(Error('Timeout'));
 expect((await call()).status).toBe(503);
 record.mockResolvedValue({data:null,error:null});
 expect((await call()).status).toBe(503);
});
it('acknowledges duplicate events and mismatch rejections without claiming the ride was paid',async()=>{
 for(const result of ['rejected_company','rejected_amount_or_currency','applied_sandbox_only']) {
  record.mockResolvedValue({data:{result,duplicate:true},error:null});
  expect(await (await call()).json()).toEqual({result});
 }
});
it('reconciles refunds from the current payment/charge, not an older refund snapshot',async()=>{
 verify.mockResolvedValue({...event,type:'refund.updated',data:{object:{id:'re_fixture',payment_intent:'pi_fixture',amount:100,status:'pending'}}});
 retrievePayment.mockResolvedValue({...payment,latest_charge:{object:'charge',id:'ch_fixture',livemode:false,payment_intent:'pi_fixture',currency:'eur',amount_refunded:300}});
 expect((await call()).status).toBe(200);expect(retrievePayment).toHaveBeenCalledExactlyOnceWith('pi_fixture');
 expect(record).toHaveBeenCalledWith(expect.objectContaining({refunded_minor:300,state:'paid'}));
});
it('keeps refund reconciliation retryable if Stripe is unavailable or the charge is foreign',async()=>{
 verify.mockResolvedValue({...event,type:'charge.refunded',data:{object:{payment_intent:'pi_fixture'}}});
 retrievePayment.mockRejectedValueOnce(Error('Stripe unavailable'));
 expect((await call()).status).toBe(503);
 retrievePayment.mockResolvedValue({...payment,latest_charge:{object:'charge',livemode:true,payment_intent:'pi_other',currency:'eur',amount_refunded:1234}});
 expect((await call()).status).toBe(400);expect(record).not.toHaveBeenCalled();
});
it('binds a hosted Checkout Session to its actual retrieved payment before recording',async()=>{
 verify.mockResolvedValue({...event,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_test_fixture',livemode:false,
  mode:'payment',payment_intent:'pi_fixture',amount_total:1234,currency:'eur',metadata:{leski_payment_order_id:order}}}});
 retrievePayment.mockResolvedValue(payment);
 expect((await call()).status).toBe(200);
 expect(record).toHaveBeenCalledWith(expect.objectContaining({checkout_session_id:'cs_test_fixture',payment_id:'pi_fixture',order_id:order,state:'paid'}));
});
it('rejects a Checkout total or metadata that differs from its underlying payment',async()=>{
 retrievePayment.mockResolvedValue(payment);
 for(const fields of [{amount_total:1},{metadata:{leski_payment_order_id:'different'}},{livemode:true},{id:'cs_live_foreign'}]) {
  verify.mockResolvedValue({...event,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_test_fixture',livemode:false,
   mode:'payment',payment_intent:'pi_fixture',amount_total:1234,currency:'eur',metadata:{leski_payment_order_id:order},...fields}}});
  expect((await call()).status).toBe(400);
 }
 expect(record).not.toHaveBeenCalled();
});
it('ignores unrelated event types and has no browser GET payment side effect',async()=>{
 verify.mockResolvedValue({...event,type:'customer.created'});
 expect((await call()).status).toBe(200);expect(record).not.toHaveBeenCalled();
 expect((await handler(new Request('https://example.invalid/stripe-webhook'))).status).toBe(405);
});


it('uses the account verified from the configured test API key for shared Test mode',async()=>{
 const accountId=vi.fn().mockResolvedValue('acct_1USiOkPYGWX41ye8');
 const testHandler=createStripeSandboxHandler({verify,retrievePayment,record,accountId});
 expect((await testHandler(new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':'signed'},body:'raw'}))).status).toBe(200);
 expect(record).toHaveBeenCalledWith(expect.objectContaining({account_id:'acct_1USiOkPYGWX41ye8',livemode:false}));
});
it('keeps test key failures retryable and rejects a signed foreign account',async()=>{
 const accountId=vi.fn().mockRejectedValueOnce(Error('Key unavailable')).mockResolvedValueOnce('acct_foreign');
 const testHandler=createStripeSandboxHandler({verify,retrievePayment,record,accountId});
 const request=()=>new Request('https://example.invalid',{method:'POST',headers:{'stripe-signature':'signed'},body:'raw'});
 expect((await testHandler(request())).status).toBe(503);expect((await testHandler(request())).status).toBe(400);expect(record).not.toHaveBeenCalled();
});
