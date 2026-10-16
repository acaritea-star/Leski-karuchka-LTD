// @vitest-environment jsdom
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),lookup:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{rpc:mocks.rpc,from:(table:string)=>{const query={select:()=>query,eq:()=>query,abortSignal:()=>query,maybeSingle:()=>mocks.lookup(table)};return query;}}}));
import {clearCheckout,completeRidePayment,findCheckout,prepareCheckout,readCheckout} from './rideCheckout';
const owner='11111111-1111-4111-8111-111111111111',driver='33333333-3333-4333-8333-333333333333',request='44444444-4444-4444-8444-444444444444';
const payload={p_actor:owner,p_request_id:request,p_choice:'cash' as const,p_partial_amount:null,p_note:''};
const response=(id:string)=>({receipt:{id,request_id:request,driver_user_id:owner,driver_id:driver,company_id:'company',choice:'cash',partial_amount:null,note:'',expected_amount:12.34,received_amount:12.34,payment_method:'cash',entry_id:id},ride:{id:request,status:'completed',driver_id:driver,company_id:'company',final_price:12.34}});
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();});
afterEach(()=>vi.restoreAllMocks());
it('persists the exact account, ride and choice before writing; forbids changed payment and scope on retry',()=>{
 const c=prepareCheckout(driver,payload);expect(readCheckout(owner)?.command).toEqual(c);
 expect(prepareCheckout(driver,payload).p_id).toBe(c.p_id);
 expect(()=>prepareCheckout(driver,{...payload,p_choice:'card'})).toThrow('Първо');
 expect(()=>prepareCheckout('99999999-9999-4999-8999-999999999999',payload)).toThrow('Първо');
 clearCheckout({...c,p_id:'other'});expect(readCheckout(owner)).not.toBeNull();clearCheckout(c);expect(readCheckout(owner)).toBeNull();
});
it('refuses blocked or corrupt storage before any financial RPC',()=>{
 localStorage.setItem(`leski:ride-checkout:${owner}`,'{');expect(()=>prepareCheckout(driver,payload)).toThrow('не може да се прочете');localStorage.clear();
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('blocked');});expect(()=>prepareCheckout(driver,payload)).toThrow('съхранението');expect(mocks.rpc).not.toHaveBeenCalled();
});
it('reconciles one lost response using the immutable payment AND completed ride, without replaying',async()=>{
 const c=prepareCheckout(driver,payload),r=response(c.p_id);mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new TypeError('offline'))});
 mocks.lookup.mockImplementation((table:string)=>Promise.resolve({data:table==='ride_payment_receipts'?r.receipt:r.ride,error:null}));
 await expect(completeRidePayment(c,driver)).resolves.toMatchObject({id:request,status:'completed'});
 expect(mocks.rpc).toHaveBeenCalledOnce();expect(mocks.lookup.mock.calls.map(c=>c[0])).toEqual(['ride_payment_receipts','taxi_requests']);
});
it('never treats a completed status alone as proof of payment and retains the operation',async()=>{
 const c=prepareCheckout(driver,payload);mocks.rpc.mockReturnValue({abortSignal:()=>Promise.reject(new TypeError('offline'))});mocks.lookup.mockResolvedValue({data:null,error:null});
 await expect(completeRidePayment(c,driver)).rejects.toThrow('същия запис');expect(readCheckout(owner)?.command.p_id).toBe(c.p_id);expect(mocks.lookup).toHaveBeenCalledOnce();
});
it('rejects a receipt from another driver or a mismatched amount, even with a completed ride',async()=>{
 const c=prepareCheckout(driver,payload),r=response(c.p_id);r.receipt.received_amount=10;
 mocks.lookup.mockImplementation((table:string)=>Promise.resolve({data:table==='ride_payment_receipts'?r.receipt:r.ride,error:null}));
 await expect(findCheckout(c,driver)).rejects.toThrow('не са потвърдени заедно');r.receipt.received_amount=12.34;r.receipt.driver_user_id='another';
 await expect(findCheckout(c,driver)).rejects.toThrow('не са потвърдени заедно');
});
it('does not reconcile or replay a definite permission rejection',async()=>{
 const c=prepareCheckout(driver,payload);mocks.rpc.mockReturnValue({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'MFA_REQUIRED'}})});
 await expect(completeRidePayment(c,driver)).rejects.toMatchObject({code:'42501'});expect(mocks.lookup).not.toHaveBeenCalled();
});
