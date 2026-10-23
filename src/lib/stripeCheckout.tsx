import { useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { preloadStripeCheckout,type CheckoutConfirmEvent,type CheckoutElement,type CheckoutOptions,type CheckoutSdk,type CheckoutSnapshot,type CheckoutStripe } from './stripeCheckoutLoader';
import { CheckoutContext,type CheckoutState } from './stripeCheckoutState';
import { startRidePaymentTiming } from './ridePaymentTiming';

// Imported only by the lazy payment dialog: warm the official script while its
// authenticated Session request runs. A failed warm-up remains retryable.
if(typeof window!=='undefined')void preloadStripeCheckout().catch(()=>undefined);

export function CheckoutElementsProvider({stripe,options,children}:{stripe:Promise<CheckoutStripe>|null;options:CheckoutOptions;children:ReactNode}) {
 const initialOptions=useRef(options),[context,setContext]=useState<{sdk:CheckoutSdk|null;state:CheckoutState}>({sdk:null,state:{type:'loading'}});
 useEffect(()=>{
  let active=true;
  void Promise.resolve(stripe).then(async instance=>{
   if(!active)return;
   if(!instance)throw Error('Payment SDK unavailable.');
   const sdk=instance.initCheckoutElementsSdk(initialOptions.current);
   setContext({sdk,state:{type:'loading'}});
   const finishTiming=startRidePaymentTiming('actions');
   const result=await sdk.loadActions();finishTiming();
   if(!active)return;
   if(result.type!=='success')throw Error('Payment Session could not be loaded.');
   const actions=result.actions;
   const update=(session:CheckoutSnapshot)=>{if(active)setContext({sdk,state:{type:'success',checkout:{...session,confirm:args=>actions.confirm(args)}}});};
   // Subscribe before reading so a later change cannot be overwritten by an
   // older snapshot. Element events and the pay button share this same state.
   sdk.on('change',update);update(actions.getSession());
  }).catch(()=>{if(active)setContext({sdk:null,state:{type:'error'}});});
  return()=>{active=false;};
 },[stripe]);
 return <CheckoutContext.Provider value={context}>{children}</CheckoutContext.Provider>;
}

type ElementProps={options?:Record<string,unknown>;onReady?:(event:{availablePaymentMethods?:{applePay?:boolean;googlePay?:boolean}|null})=>void;onConfirm?:(event:CheckoutConfirmEvent)=>void;onLoadError?:()=>void;onFocus?:()=>void};
function CheckoutElementView({kind,...props}:ElementProps&{kind:'payment'|'express'|'contact'}) {
 const context=useContext(CheckoutContext),sdk=context?.sdk,node=useRef<HTMLDivElement>(null),callbacks=useRef(props),initialOptions=useRef(props.options);
 callbacks.current=props;
 const [failed,setFailed]=useState(false);
 useEffect(()=>{
  if(!sdk||!node.current)return;
  let element:CheckoutElement|undefined,active=true;
  try{
   element=kind==='payment'?sdk.createPaymentElement(initialOptions.current):kind==='express'?sdk.createExpressCheckoutElement(initialOptions.current):sdk.createContactDetailsElement();
   const finishTiming=kind==='contact'?()=>{}:startRidePaymentTiming(kind==='payment'?'card':'wallet');
   element.on('ready',event=>{if(active){finishTiming();callbacks.current.onReady?.(event);}});
   if(kind==='payment')element.on('focus',()=>{if(active)callbacks.current.onFocus?.();});
   element.on('loaderror',()=>{if(active){setFailed(true);callbacks.current.onLoadError?.();}});
   if(kind==='express')element.on('confirm',event=>{if(active)callbacks.current.onConfirm?.(event);});
   element.mount(node.current);
  }catch(error){element?.destroy();throw error;}
  return()=>{active=false;element?.destroy();};
 },[sdk,kind]);
 return <><div ref={node}/>{failed&&kind!=='express'&&!props.onLoadError&&<p role="alert" className="booking-error">Защитената форма не се зареди. Затвори плащането и опитай отново.</p>}</>;
}

export function PaymentElement(props:ElementProps){return <CheckoutElementView kind="payment" {...props}/>;}
export function ExpressCheckoutElement(props:ElementProps){return <CheckoutElementView kind="express" {...props}/>;}
export function ContactDetailsElement(){return <CheckoutElementView kind="contact"/>;}
