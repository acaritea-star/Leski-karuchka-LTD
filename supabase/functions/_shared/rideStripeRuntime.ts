import Stripe from 'npm:stripe@22.6.0';
import { admin } from './auth.ts';
import { LIVE_RIDE_ACCOUNT, type RideOrder, type RideStripeSnapshot } from './rideStripe.ts';
const testKey=(Deno.env.get('STRIPE_API_KEY')??'').trim();
const liveKey=(Deno.env.get('STRIPE_LIVE_SECRET_KEY')??testKey).trim();
export const testRideStripe=new Stripe(testKey||'not_configured',{timeout:6000,maxNetworkRetries:0});
export const rideStripe=new Stripe(liveKey||'not_configured',{timeout:6000,maxNetworkRetries:0});
export const stripeForRide=(live:boolean)=>live?rideStripe:testRideStripe;
const ready=new Map<boolean,Promise<Stripe.Account>>();
export async function requireRideStripe(live=true,requireCharges=false) {
 const key=live?liveKey:testKey;
 if(!(live?/^(sk|rk)_live_/:/^(sk|rk)_test_/).test(key))throw Error('Stripe key environment mismatch');
 let check=ready.get(live);
 if(!check){check=stripeForRide(live).accounts.retrieve(null).then(account=>{
  if(live?account.id!==LIVE_RIDE_ACCOUNT:![LIVE_RIDE_ACCOUNT,'acct_1USiOtBXRX2hZ2VT'].includes(account.id))throw Error('Stripe account mismatch');
  return account;
 }).catch(error=>{ready.delete(live);throw error;});ready.set(live,check);}
 const account=await check;
 if(live&&requireCharges&&!account.charges_enabled)throw Error('Live merchant is not ready');
 return account.id;
}
export async function paymentRpc(name:string,args:Record<string,unknown>) {
 const {data,error}=await admin.rpc(name,args).abortSignal(AbortSignal.timeout(8000));
 if(error)throw error;return data;
}
export const rideStripeDependenciesForMode=(live:boolean)=>({
 lookup:async(id:string)=>await paymentRpc('lookup_ride_checkout',{p_order_id:id}) as RideOrder|null,
 retrieveSession:async(id:string)=>{await requireRideStripe(live);return stripeForRide(live).checkout.sessions.retrieve(id);},
 retrievePayment:async(id:string)=>{await requireRideStripe(live);return stripeForRide(live).paymentIntents.retrieve(id,{expand:['latest_charge']});},
 record:async(snapshot:RideStripeSnapshot)=>await paymentRpc('record_ride_stripe_snapshot',snapshot),
});
export const rideStripeDependencies=rideStripeDependenciesForMode(true);
