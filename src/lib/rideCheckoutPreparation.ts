import type { RideElementsSession, RidePaymentPreparation } from './ridePayment';

/** Ride-local only. An unresolved secret lets Stripe fetch its UI resources;
 * it cannot load a Session or confirm anything until the server permits it. */
export function createRideCheckoutPreparation() {
 let resolve!:(value:string)=>void,reject!:(reason:Error)=>void,leases=0;
 const clientSecret=new Promise<string>((yes,no)=>{resolve=yes;reject=no;});
 // A canceled ride may never mount the SDK. Keep cancellation handled then too.
 void clientSecret.catch(()=>undefined);
 const cancel=()=>reject(Error('Payment preparation ended.'));
 return {clientSecret,cancel,
  retain(){leases++;return()=>{leases--;queueMicrotask(()=>{if(leases===0)cancel();});};},
  accept(session:RideElementsSession,expected:RidePaymentPreparation|null) {
   if(expected&&(session.account_id!==expected.account_id||session.publishable_key!==expected.publishable_key||session.environment!==expected.environment)) {
    reject(Error('Payment configuration changed.'));
    throw Error('Payment configuration changed.');
   }
   resolve(session.client_secret);
  }};
}
