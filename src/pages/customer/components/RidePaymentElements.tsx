import { Component,useCallback,useEffect,useMemo,useRef,useState,type ReactNode } from 'react';
import { loadStripe,type CheckoutConfirmEvent } from '@/lib/stripeCheckoutLoader';
import { CheckoutElementsProvider,ContactDetailsElement,ExpressCheckoutElement,PaymentElement } from '@/lib/stripeCheckout';
import { useCheckoutElements } from '@/lib/stripeCheckoutState';
import { createRideCheckoutPreparation } from '@/lib/rideCheckoutPreparation';
import { startRidePaymentTiming } from '@/lib/ridePaymentTiming';
import Modal from '@/components/feature/Modal';
import { money } from '@/lib/accounting';
import { paymentPreferenceKey,rememberPaymentMethod,ridePaymentAction,type RideElementsSession,type RidePaymentResult,type RidePaymentPreparation } from '@/lib/ridePayment';

const INITIALIZATION_WAIT_MS=12000;
function PaymentLoadRecovery({onRetry,delayed=false}:{onRetry:()=>void;delayed?:boolean}) {
 return <div role={delayed?'status':'alert'} className={delayed?'rounded-xl bg-background-50 p-3 text-sm':'booking-error'}><p>{delayed?'Връзката е бавна. Продължаваме да зареждаме плащането.':'Плащането не се зареди. Опитай отново със същото плащане.'}</p><button type="button" className="min-h-11 underline" onClick={onRetry}>Зареди плащането отново</button></div>;
}
class PaymentSdkBoundary extends Component<{children:ReactNode;onRetry:()=>void},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<PaymentLoadRecovery onRetry={this.props.onRetry}/>:this.props.children;}
}

export default function RidePaymentElements({requestId,userId,onClose,onChanged,open=true,enabled=true,preparation=null}:{requestId:string;userId:string;onClose:()=>void;onChanged:()=>Promise<boolean|void>;open?:boolean;enabled?:boolean;preparation?:RidePaymentPreparation|null}) {
 const [session,setSession]=useState<RideElementsSession|null>(null),[legacy,setLegacy]=useState<RidePaymentResult|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0),[busy,setBusy]=useState(false);
 const [sdkAttempt,setSdkAttempt]=useState(0);
 const changed=useRef(onChanged);changed.current=onChanged;
 const retrySdk=useCallback(()=>setSdkAttempt(value=>value+1),[]);
 const gate=useMemo(()=>({attempt:sdkAttempt,...createRideCheckoutPreparation()}),[sdkAttempt]);
 const expected=useRef(preparation);
 useEffect(()=>gate.retain(),[gate]);
 useEffect(()=>{if(session){try{gate.accept(session,expected.current);}catch{setError('Платежната конфигурация се промени. Обнови курса.');}}},[session,gate]);
 useEffect(()=>{
  if(!enabled)return;
  const abort=new AbortController(),finishTiming=startRidePaymentTiming('session');setError('');setSession(null);setLegacy(null);
  void ridePaymentAction(requestId,'elements',abort.signal).then(result=>{
   if(abort.signal.aborted)return;
   finishTiming();if('ui_mode' in result)setSession(result);
   else {setLegacy(result);void changed.current();}
  }).catch(()=>{if(!abort.signal.aborted)setError('Не успяхме да заредим плащането. Опитай отново със същия курс.');});
  return()=>abort.abort();
 },[requestId,userId,attempt,enabled]);
 const publicKey=preparation?.publishable_key??session?.publishable_key;
 const sdk=useMemo(()=>publicKey?{key:sdkAttempt,stripe:loadStripe(publicKey)}:null,[publicKey,sdkAttempt]);
 const cancel=async()=>{
  if(busy)return;setBusy(true);setError('');
  try {const result=await ridePaymentAction(requestId,'cancel');await onChanged();if(result.state==='canceled'||result.state==='paid')onClose();else setError('Плащането още се проверява. Изчакай потвърждение преди друг начин на плащане.');}
  catch {setError('Не успяхме да проверим плащането. Опитай отново, когато имаш интернет.');}
  finally {setBusy(false);}
 };
 return <Modal open={open} label="Плащане на пътуването" onClose={onClose} busy={busy} allowExternalOverlays className="ride-payment-dialog">
  <div className="ride-payment-header flex items-center justify-between gap-3 mb-4"><h2 className="text-xl font-bold">Пристигнахте</h2><button type="button" aria-label="Затвори плащането" className="h-11 w-11 shrink-0 rounded-full bg-background-100 text-2xl" onClick={onClose}><span aria-hidden="true">×</span></button></div>
  {session&&<><div className="flex justify-between items-baseline gap-3 mb-3"><span>Сума за плащане</span><strong className="text-3xl font-bold tabular-nums">{money(session.amount_minor/100)}</strong></div>
   {session.environment==='test'&&<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 mb-3">Тестов режим · Не се теглят реални пари</p>}</>}
  {sdk&&!error&&!legacy&&<PaymentSdkBoundary key={sdk.key} onRetry={retrySdk}>
   <CheckoutElementsProvider stripe={sdk.stripe} options={{clientSecret:gate.clientSecret,elementsOptions:{appearance:{theme:'stripe',variables:{colorPrimary:'#15803d',borderRadius:'12px',fontFamily:'system-ui, sans-serif',fontSizeBase:'16px'}},loader:'auto',savedPaymentMethod:{enableSave:'auto',enableRedisplay:'auto'}}}}>
    <RidePaymentForm session={session} preparation={preparation} active={open&&enabled} userId={userId} onBusy={setBusy} onChanged={onChanged} onRetry={retrySdk} />
   </CheckoutElementsProvider>
  </PaymentSdkBoundary>}
  {legacy?<div role="status" className="space-y-3">
   <p>{legacy.url?'Имате започнато плащане. Продължете го, за да избегнем повторно таксуване.':legacy.state==='paid'?'Плащането е потвърдено.':'Проверяваме състоянието на плащането.'}</p>
   {legacy.url&&<a href={legacy.url} className="booking-primary w-full">Продължи плащането</a>}
  </div>:!sdk&&!error&&<p role="status" className="py-6 text-center">Зареждаме сигурното плащане…</p>}
  {error&&<div role="alert" className="booking-error mt-3"><p>{error}</p><button type="button" className="min-h-11 underline" onClick={()=>{setSession(null);setAttempt(v=>v+1);retrySdk();}}>Опитай отново</button></div>}
  <div className="mt-4 border-t border-background-200 pt-3 text-center">
   <p className="text-xs text-foreground-500"><i className="ri-lock-line" aria-hidden="true" /> Сигурно плащане през Stripe</p>
   {(session||legacy?.url)&&<button type="button" className="min-h-11 text-sm underline" disabled={busy} onClick={()=>void cancel()}>{(session?.environment??legacy?.environment)==='test'?'Отмени тестовото плащане':'Предпочитам в брой'}</button>}
  </div>
 </Modal>;
}

export function RidePaymentForm({session,userId,onBusy,onChanged,onRetry,preparation=null,active=true}:{session:RideElementsSession|null;userId:string;onBusy:(busy:boolean)=>void;onChanged:()=>Promise<boolean|void>;onRetry:()=>void;preparation?:RidePaymentPreparation|null;active?:boolean}) {
 const result=useCheckoutElements(),key=paymentPreferenceKey(userId,session?.account_id??preparation?.account_id??'',session?.environment??preparation?.environment??'test');
 const [wallets,setWallets]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[awaiting,setAwaiting]=useState(false),[error,setError]=useState('');
 const [cardReady,setCardReady]=useState(false),[cardFailed,setCardFailed]=useState(false);
 const ready=result.type==='success'&&(cardReady||wallets===true);
 const [initializationDelayed,setInitializationDelayed]=useState(false);
 useEffect(()=>{
  if(!session||ready||result.type==='error')return;
  const timer=window.setTimeout(()=>setInitializationDelayed(true),INITIALIZATION_WAIT_MS);
  return()=>window.clearTimeout(timer);
 },[ready,result.type,session]);
 const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const reconcile=useCallback(async()=>{
  if(!session||lock.current)return;lock.current=true;setBusy(true);onBusy(true);setError('');
  try {const checked=await ridePaymentAction(session.request_id,'reconcile');await onChanged();if(alive.current)setAwaiting(checked.state!=='paid'&&checked.state!=='canceled'&&checked.state!=='open');}
  catch {if(alive.current)setError('Потвърждението се забави. Провери отново — използваме същото плащане.');}
  finally {lock.current=false;if(alive.current){setBusy(false);onBusy(false);}}
 },[session,onChanged,onBusy]);
 useEffect(()=>{
  if(!awaiting)return;
  const online=()=>{if(document.visibilityState!=='hidden'&&navigator.onLine)void reconcile();};
  window.addEventListener('online',online);document.addEventListener('visibilitychange',online);
  const timer=window.setTimeout(online,2500);
  return()=>{clearTimeout(timer);window.removeEventListener('online',online);document.removeEventListener('visibilitychange',online);};
 },[awaiting,reconcile]);
 if(result.type==='error')return <PaymentLoadRecovery onRetry={onRetry}/>;
 const checkout=session&&result.type==='success'?result.checkout:null;
 if(session&&checkout&&(checkout.id!==session.session_id || checkout.livemode!==(session.environment==='live') || checkout.currency!=='eur' || checkout.total.total.minorUnitsAmount!==session.amount_minor))return <p role="alert" className="booking-error">Сумата не съвпада. Обнови курса преди плащане.</p>;
 const confirm=async(event?:CheckoutConfirmEvent)=>{
  if(!active||!session||!checkout||lock.current||awaiting||(!event&&(!cardReady||cardFailed||!checkout.canConfirm)))return;lock.current=true;setBusy(true);onBusy(true);setError('');
  try {
   const finishTiming=startRidePaymentTiming('confirm');
   const confirmed=await checkout.confirm({redirect:'if_required',...(event?{expressCheckoutConfirmEvent:event}:{})});
   finishTiming();
   if(!alive.current)return;
   if(confirmed.type==='error'){setError(confirmed.error.message||'Плащането не е завършено. Провери данните и опитай отново.');return;}
   rememberPaymentMethod(key,event?'wallet':'card');setAwaiting(true);
   // The SDK never marks a ride paid. Prefer the webhook's authoritative DB
   // result; only contact Stripe again when that result has not arrived.
   try {if(await onChanged()===true)return;const checked=await ridePaymentAction(session.request_id,'reconcile');await onChanged();if(alive.current)setAwaiting(!['paid','canceled','open'].includes(checked.state));}
   catch {if(alive.current)setError('Потвърждаваме плащането. При прекъсната връзка натисни „Провери плащането“.');}
  }catch {if(alive.current){setAwaiting(true);setError('Връзката прекъсна. Провери плащането преди следващ опит.');}}
  finally {lock.current=false;if(alive.current){setBusy(false);onBusy(false);}}
 };
 return <div className="space-y-3" aria-busy={busy}>
  {result.type==='loading'&&<p role="status" className="text-sm text-center">Подготвяме начините за плащане…</p>}
  {!ready&&initializationDelayed&&<PaymentLoadRecovery onRetry={onRetry} delayed/>}
  {checkout&&!checkout.email&&<ContactDetailsElement />}
  <div hidden={awaiting} inert={!checkout||busy}><ExpressCheckoutElement options={{buttonHeight:48,buttonTheme:{applePay:'black',googlePay:'black'},buttonType:{applePay:'plain',googlePay:'pay'},paymentMethodOrder:['apple_pay','google_pay'],layout:{maxColumns:1,maxRows:2},paymentMethods:{applePay:'auto',googlePay:'auto',link:'never',amazonPay:'never',paypal:'never',klarna:'never'}}}
   onReady={event=>setWallets(!!(event.availablePaymentMethods?.applePay||event.availablePaymentMethods?.googlePay))}
   onLoadError={()=>setWallets(false)} onConfirm={event=>void confirm(event)} /></div>
  {!awaiting&&wallets&&<div className="flex items-center gap-3 text-xs text-foreground-500"><span className="h-px flex-1 bg-background-200"/><span>или с карта</span><span className="h-px flex-1 bg-background-200"/></div>}
  {/* Mount both Elements immediately, even while loadActions/wallet detection
      are pending. Keep card entry visible even when a wallet becomes available late. */}
  <form hidden={awaiting} className="space-y-3" onSubmit={event=>{event.preventDefault();void confirm();}}>
   <div inert={busy||awaiting}><PaymentElement options={{layout:{type:'accordion',defaultCollapsed:false},wallets:{applePay:'never',googlePay:'never',link:'never'}}}
    onReady={()=>setCardReady(true)} onLoadError={()=>setCardFailed(true)} /></div>
   {cardFailed&&<PaymentLoadRecovery onRetry={onRetry}/>}
   <div className="sticky bottom-0 z-10 bg-white py-2"><button type="submit" className="booking-primary w-full disabled:opacity-40" disabled={!active||!session||busy||awaiting||!cardReady||cardFailed||!checkout?.canConfirm}>{busy?'Потвърждаваме…':session?`${session.environment==='test'?'Тествай':'Плати'} ${money(session.amount_minor/100)}`:'Плати с карта'}</button></div>
  </form>
  {awaiting&&<div role="status"><p>Потвърждаваме плащането…</p><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void reconcile()}>Провери плащането</button></div>}
  {error&&<p role="alert" className="booking-error">{error}</p>}
 </div>;
}
