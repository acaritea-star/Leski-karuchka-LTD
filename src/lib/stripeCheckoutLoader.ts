export const STRIPE_CHECKOUT_SCRIPT='https://js.stripe.com/endive/stripe.js';
export type CheckoutConfirmEvent={paymentType?:string};
export type CheckoutSnapshot={id:string;livemode:boolean;currency:string;email:string|null;canConfirm:boolean;total:{total:{minorUnitsAmount:number}}};
export type CheckoutConfirmOptions={redirect:'if_required';expressCheckoutConfirmEvent?:CheckoutConfirmEvent};
export type CheckoutConfirmResult={type:'success';session?:unknown}|{type:'error';error:{message?:string}};
export type CheckoutActions={getSession:()=>CheckoutSnapshot;confirm:(options:CheckoutConfirmOptions)=>Promise<CheckoutConfirmResult>};
export type CheckoutOptions={clientSecret:string;elementsOptions:Record<string,unknown>};
type ElementEvents={ready:{availablePaymentMethods?:{applePay?:boolean;googlePay?:boolean}|null};confirm:CheckoutConfirmEvent;loaderror:unknown};
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
export type CheckoutStripeConstructor=((key:string,options:{locale:'bg'})=>CheckoutStripe)&{version?:string};
let loading:Promise<CheckoutStripeConstructor>|null=null;
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
  const script=document.createElement('script');script.src=STRIPE_CHECKOUT_SCRIPT;script.async=true;script.dataset.rideStripeSdk='endive';
  const cleanup=()=>{clearTimeout(timer);script.removeEventListener('load',ready);script.removeEventListener('error',failed);};
  const failed=()=>{cleanup();script.remove();reject(Error('Secure payment script could not be loaded.'));};
  const ready=()=>{const stripe=constructor();if(stripe?.version!=='endive'){failed();return;}cleanup();resolve(stripe);};
  const timer=setTimeout(failed,10000);
  script.addEventListener('load',ready);script.addEventListener('error',failed);document.head.appendChild(script);
 });
 const tracked=pending.catch(error=>{if(loading===tracked)loading=null;throw error;});
 loading=tracked;return tracked;
}

export async function loadStripe(key:string):Promise<CheckoutStripe> {
 if(!/^pk_(test|live)_/.test(key))throw Error('Invalid payment configuration.');
 const Stripe=await preloadStripeCheckout(),stripe=Stripe(key,{locale:'bg'});
 if(typeof stripe?.initCheckoutElementsSdk!=='function')throw Error('Unsupported payment SDK.');
 return stripe;
}
