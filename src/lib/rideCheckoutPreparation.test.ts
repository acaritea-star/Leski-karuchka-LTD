import {expect,it,vi} from 'vitest';
import {createRideCheckoutPreparation} from './rideCheckoutPreparation';
import type {RideElementsSession} from './ridePayment';
const session:RideElementsSession={request_id:'ride',state:'open',ui_mode:'elements',environment:'test',account_id:'acct_owner',publishable_key:'pk_test_owner',session_id:'cs_test_one',client_secret:'cs_test_one_secret_fixture',amount_minor:295,currency:'eur'};
it('exposes no secret until an authorised Session arrives, then keeps the same promise',async()=>{
 const gate=createRideCheckoutPreparation(),resolved=vi.fn();void gate.clientSecret.then(resolved);
 await Promise.resolve();expect(resolved).not.toHaveBeenCalled();gate.accept(session,session);
 await expect(gate.clientSecret).resolves.toBe(session.client_secret);
});
it.each([{account_id:'acct_other'},{environment:'live' as const},{publishable_key:'pk_test_other'}])('refuses a changed merchant or mode %j',mutation=>{
 const gate=createRideCheckoutPreparation();expect(()=>gate.accept(session,{...session,...mutation})).toThrow();return expect(gate.clientSecret).rejects.toThrow();
});
it('survives effect replay but releases a genuine unmount',async()=>{
 const gate=createRideCheckoutPreparation();const release=gate.retain();release();const releaseAgain=gate.retain();await Promise.resolve();gate.accept(session,session);
 await expect(gate.clientSecret).resolves.toBe(session.client_secret);releaseAgain();
 const canceled=createRideCheckoutPreparation();canceled.retain()();await expect(canceled.clientSecret).rejects.toThrow('preparation ended');
});
