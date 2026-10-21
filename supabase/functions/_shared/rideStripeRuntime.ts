import Stripe from 'npm:stripe@22.6.0';
import { admin } from './auth.ts';
import { LIVE_RIDE_ACCOUNT, type RideOrder, type RideStripeSnapshot } from './rideStripe.ts';
// The legacy key is accepted only after account identity verification. A sandbox
// key can never create or reconcile an order linked to a real ride.
export const rideStripe=new Stripe(Deno.env.get('STRIPE_LIVE_SECRET_KEY')??Deno.env.get('STRIPE_API_KEY')??'not_configured',{timeout:6000,maxNetworkRetries:0});
let ready:Promise<void>|undefined;
export async function requireRideStripe() {
 if(!ready)ready=rideStripe.accounts.retrieve(null).then(account=>{
  if(account.id!==LIVE_RIDE_ACCOUNT || !account.charges_enabled)throw Error('Live merchant is not ready');
 }).catch(error=>{ready=undefined;throw error;});
 await ready;
}
export async function paymentRpc(name:string,args:Record<string,unknown>) {
 const {data,error}=await admin.rpc(name,args).abortSignal(AbortSignal.timeout(8000));
 if(error)throw error;return data;
}
export const rideStripeDependencies={
 lookup:async(id:string)=>await paymentRpc('lookup_ride_checkout',{p_order_id:id}) as RideOrder|null,
 retrieveSession:async(id:string)=>{await requireRideStripe();return rideStripe.checkout.sessions.retrieve(id);},
 retrievePayment:async(id:string)=>{await requireRideStripe();return rideStripe.paymentIntents.retrieve(id,{expand:['latest_charge']});},
 record:async(snapshot:RideStripeSnapshot)=>await paymentRpc('record_ride_stripe_snapshot',snapshot),
};
