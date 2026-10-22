import { lazy,Suspense,useCallback,useEffect,useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { loadRidePayment,ridePaymentAction,onlinePaymentLabel } from '@/lib/ridePayment';
import { money } from '@/lib/accounting';
const RidePaymentElements=lazy(()=>import('./RidePaymentElements'));
export default function CustomerRidePayment({requestId,price,endedAt,revision}:{requestId:string;price:number|null;endedAt?:string|null;revision?:string}) {
 const {user}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const lock=useRef(false);
 const payment=useQuery({queryKey:['ride-payment-state',user?.id,requestId],enabled:!!user?.id,
  queryFn:({signal})=>loadRidePayment(requestId,signal),retry:1,staleTime:10000,
  refetchInterval:q=>q.state.data?.ended_at && ['creating','open','processing'].includes(q.state.data.state)?10000:false,
  refetchIntervalInBackground:false});
 const refresh=payment.refetch;
 useEffect(()=>{void refresh();},[revision,refresh]);
 const data=payment.data,testMode=data?.environment==='test',ended=!!endedAt || !!data?.ended_at;
 const paid=data?.payment_status==='paid' && data.payment_method==='online';
 const active=!!data && ['creating','open','processing'].includes(data.state);
 const identity=`${user?.id}:${requestId}`,[openIdentity,setOpenIdentity]=useState<string|null>(null),autoOpened=useRef('');
 const changed=useCallback(async()=>{await refresh();},[refresh]);
 useEffect(()=>{
  if(ended||!data?.eligible||!data.inline_available||!navigator.onLine)return;
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean}}).connection;
  if(connection?.saveData)return;
  let active=true;
  const warm=()=>{if(active)void import('@/lib/stripeCheckoutLoader').then(sdk=>{if(active)return sdk.preloadStripeCheckout();}).catch(()=>undefined);};
  const idle=typeof window.requestIdleCallback==='function'?window.requestIdleCallback(warm,{timeout:1500}):null;
  const timer=idle===null?window.setTimeout(warm,750):null;
  return()=>{active=false;if(idle!==null)window.cancelIdleCallback(idle);if(timer!==null)window.clearTimeout(timer);};
 },[identity,ended,data?.eligible,data?.inline_available]);
 useEffect(()=>{
  if(ended&&data?.eligible&&data.inline_available&&data.state!=='processing'&&autoOpened.current!==identity){autoOpened.current=identity;setOpenIdentity(identity);}
 },[ended,data?.eligible,data?.inline_available,data?.state,identity]);
 useEffect(()=>{if(paid)setOpenIdentity(null);},[paid]);
 const run=async(action:'checkout'|'cancel'|'reconcile')=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const result=await ridePaymentAction(requestId,action);
   if(action==='checkout' && result.url){window.location.assign(result.url);return;}
   await refresh();setMessage(result.state==='paid'?onlinePaymentLabel(data?.environment,'paid'):result.state==='canceled'?(testMode?'Тестовото плащане е отменено. Можеш да започнеш нов тест.':'Онлайн плащането е отменено. Можеш да платиш в брой на шофьора.'):'Проверяваме плащането…');
  }catch(cause){setError(cause instanceof Error?cause.message:'Плащането не е потвърдено.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="w-full space-y-2" aria-label="Плащане по пътуването">
  <div className="flex items-center justify-between gap-3 text-sm"><span>{ended?'Дължима сума':'Цена на пътуването'}</span><strong className="text-xl tabular-nums">{money(data?.amount??price)}</strong></div>
  {testMode&&<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Тестов режим · Не се теглят реални пари</p>}
  {paid?<p role="status" className="font-semibold text-primary-700">{onlinePaymentLabel(data?.environment,'paid')}</p>:data?.eligible?<>
   <button type="button" className="booking-primary w-full disabled:opacity-40" disabled={!ended || busy || payment.isError || data.state==='processing'} onClick={()=>data.inline_available?setOpenIdentity(identity):void run('checkout')}>
    <i className="ri-bank-card-line" aria-hidden="true" />{busy?'Проверка…':data.state==='processing'?'Проверяваме плащането…':active?'Продължи плащането':testMode?'Тествай плащане с карта':'Плати онлайн с карта'}
   </button>
   <p className="text-xs text-foreground-500">{ended?(testMode?'Използвай тестова карта на Stripe. Сумата не влиза в реалния отчет.':'Apple Pay и други налични методи през Stripe. Можеш да платиш и в брой.'):'Плащането се отключва, когато шофьорът отбележи края на пътуването.'}</p>
   {active&&<div className="flex flex-wrap gap-x-4 text-xs"><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void run('reconcile')}>Провери плащането</button><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void run('cancel')}>{testMode?'Отмени тестовото плащане':'Премини към плащане в брой'}</button></div>}
  </>:ended&&<p className="text-sm">Плати на шофьора. Онлайн плащането не е включено за този курс.</p>}
  {payment.isError&&<button type="button" className="min-h-11 text-xs underline" onClick={()=>void refresh()}>Обнови възможностите за плащане</button>}
  {message&&<p role="status" className="text-xs text-primary-700">{message}</p>}
  {error&&<p role="alert" className="booking-error">{error}</p>}
  {openIdentity===identity&&user?.id&&data?.eligible&&<Suspense fallback={<p role="status" className="text-sm">Зареждаме плащането…</p>}><RidePaymentElements key={identity} requestId={requestId} userId={user.id} onClose={()=>setOpenIdentity(null)} onChanged={changed} /></Suspense>}
 </div>;
}

