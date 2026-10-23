import { startRidePaymentTiming } from './ridePaymentTiming';
export const STRIPE_CHECKOUT_SCRIPT='https://js.stripe.com/endive/stripe.js';
export type CheckoutConfirmEvent={paymentType?:string};
export type CheckoutSnapshot={id:string;livemode:boolean;currency:string;email:string|null;canConfirm:boolean;total:{total:{minorUnitsAmount:number}}};
export type CheckoutConfirmOptions={redirect:'if_required';expressCheckoutConfirmEvent?:CheckoutConfirmEvent};
export type CheckoutConfirmResult={type:'success';session?:unknown}|{type:'error';error:{message?:string}};
export type CheckoutActions={getSession:()=>CheckoutSnapshot;confirm:(options:CheckoutConfirmOptions)=>Promise<CheckoutConfirmResult>};
export type CheckoutOptions={clientSecret:string|Promise<string>;elementsOptions:Record<string,unknown>};
type ElementEvents={ready:{availablePaymentMethods?:{applePay?:boolean;googlePay?:boolean}|null};confirm:CheckoutConfirmEvent;loaderror:unknown;focus:unknown};
export interface CheckoutElement {
 mount:(node:HTMLElement)=>void;
 destroy:()=>void;
 on:<K extends keyof ElementEvents>(event:K,handler:(value:ElementEvents[K])=>void)=>unknown;
}
export interface CheckoutSdk {
 on:(event:'change',handler:(session:CheckoutSnapshot)=>void)=>void;
 loadActions:()=>Promise<{type:'success';actions:CheckoutActions}|{type:'error';error:unknown}>;
 createPaymentElement:(options?:Record<string,unknown>)=>CheckoutElement;
 createExpressCheckoutElement:(options?:Record<string,unknown>)=>CheckoutElement;
 createContactDetailsElement:()=>CheckoutElement;
}
export type CheckoutStripe={initCheckoutElementsSdk:(options:CheckoutOptions)=>CheckoutSdk};
export type CheckoutStripeConstructor=((key:string,options:{locale:'bg';developerTools:{assistant:{enabled:false}}})=>CheckoutStripe)&{version?:string};
let loading:Promise<CheckoutStripeConstructor>|null=null;
// Stripe recommends sharing one instance for an identical public key/options.
// This contains no customer, Session secret or payment data. Each dialog still
// creates its own Checkout SDK; different merchants/modes never share instances.
const instances=new Map<string,Promise<CheckoutStripe>>();
const constructor=()=>typeof window==='undefined'?undefined:(window as Window&{Stripe?:CheckoutStripeConstructor}).Stripe;

/** The payment chunk alone loads Stripe's versioned, official script. No card
 * data or Session secret is passed through this shared, account-free loader. */
export function preloadStripeCheckout():Promise<CheckoutStripeConstructor> {
 const existing=constructor();
 if(existing?.version==='endive')return Promise.resolve(existing);
 if(loading)return loading;
 const pending=new Promise<CheckoutStripeConstructor>((resolve,reject)=>{
  if(typeof document==='undefined'){reject(Error('Stripe requires a browser.'));return;}
  // A previous failed download must not trap all subsequent retry attempts.
  document.querySelector<HTMLScriptElement>(`script[data-ride-stripe-sdk="endive"]`)?.remove();
  const finishTiming=startRidePaymentTiming('script');
  const script=document.createElement('script');script.src=STRIPE_CHECKOUT_SCRIPT;script.async=true;script.dataset.rideStripeSdk='endive';
  const cleanup=()=>{clearTimeout(timer);script.removeEventListener('load',ready);script.removeEventListener('error',failed);};
  const failed=()=>{cleanup();script.remove();reject(Error('Secure payment script could not be loaded.'));};
  const ready=()=>{const stripe=constructor();if(stripe?.version!=='endive'){failed();return;}cleanup();finishTiming();resolve(stripe);};
  // The dialog offers recovery after 12s without aborting a slow download.
  // Keep a longer hard deadline so a viable mobile connection can finish.
  const timer=setTimeout(failed,30000);
  script.addEventListener('load',ready);script.addEventListener('error',failed);document.head.appendChild(script);
 });
 const tracked=pending.catch(error=>{if(loading===tracked)loading=null;throw error;});
 loading=tracked;return tracked;
}

export function loadStripe(key:string):Promise<CheckoutStripe> {
 if(!/^pk_(test|live)_/.test(key))return Promise.reject(Error('Invalid payment configuration.'));
 const existing=instances.get(key);if(existing)return existing;
 const pending=preloadStripeCheckout().then(Stripe=>{
  const stripe=Stripe(key,{locale:'bg',developerTools:{assistant:{enabled:false}}});
  if(typeof stripe?.initCheckoutElementsSdk!=='function')throw Error('Unsupported payment SDK.');
  return stripe;
 });
 const tracked=pending.catch(error=>{if(instances.get(key)===tracked)instances.delete(key);throw error;});
 // A bounded cache also covers a future user visiting several Connect merchants.
 if(instances.size>=4)instances.delete(instances.keys().next().value!);
 instances.set(key,tracked);return tracked;
}
