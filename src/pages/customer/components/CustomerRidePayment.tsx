import { lazy,Suspense,useCallback,useEffect,useRef,useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { loadRidePayment,ridePaymentAction,onlinePaymentLabel } from '@/lib/ridePayment';
import { money } from '@/lib/accounting';
const RidePaymentElements=lazy(()=>import('./RidePaymentElements'));
export default function CustomerRidePayment({requestId,price,endedAt,revision}:{requestId:string;price:number|null;endedAt?:string|null;revision?:string}) {
 const client=useQueryClient();
 const {user}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const lock=useRef(false);
 const payment=useQuery({queryKey:['ride-payment-state',user?.id,requestId],enabled:!!user?.id,
  queryFn:({signal})=>loadRidePayment(requestId,signal),retry:1,staleTime:10000,refetchOnWindowFocus:true,
  refetchInterval:q=>q.state.data?.ended_at && ['creating','open','processing'].includes(q.state.data.state)?10000:false,
  refetchIntervalInBackground:false});
 const refresh=payment.refetch;
 const lastRevision=useRef({requestId,revision});
 useEffect(()=>{
  const previous=lastRevision.current;lastRevision.current={requestId,revision};
  if(previous.requestId===requestId&&previous.revision!==revision)void refresh({cancelRefetch:false});
 },[requestId,revision,refresh]);
 useEffect(()=>{
  if(!user?.id)return;
  const resume=()=>{if(document.visibilityState!=='hidden'&&navigator.onLine)void refresh({cancelRefetch:false});};
  window.addEventListener('pageshow',resume);
  return()=>window.removeEventListener('pageshow',resume);
 },[user?.id,refresh]);
 const data=payment.data,testMode=data?.environment==='test',ended=!!endedAt || !!data?.ended_at;
 const paid=data?.payment_status==='paid';
 const active=!!data && ['creating','open','processing'].includes(data.state);
 const identity=`${user?.id}:${requestId}`,[openIdentity,setOpenIdentity]=useState<string|null>(null),[preparedIdentity,setPreparedIdentity]=useState<string|null>(null),[armedIdentity,setArmedIdentity]=useState<string|null>(null),autoPrepared=useRef('');
 const changed=useCallback(async()=>{
  const cached=client.getQueryData<import('@/lib/ridePayment').RidePaymentState>(['ride-payment-state',user?.id,requestId]);
  if(cached&&['paid','refunded'].includes(cached.payment_status))return true;
  const result=await refresh({cancelRefetch:false});
  return !!result.data&&['paid','refunded'].includes(result.data.payment_status);
 },[client,user?.id,requestId,refresh]);
 useEffect(()=>{
  if(ended||!data?.eligible||!data.inline_available||!navigator.onLine)return;
  const connection=(navigator as Navigator&{connection?:{saveData?:boolean}}).connection;
  if(connection?.saveData)return;
  let active=true;
  const warm=()=>{if(!active)return;if(data.preparation)setPreparedIdentity(identity);else void import('@/lib/stripeCheckoutLoader').then(sdk=>{if(active)return sdk.preloadStripeCheckout();}).catch(()=>undefined);};
  const idle=typeof window.requestIdleCallback==='function'?window.requestIdleCallback(warm,{timeout:1500}):null;
  const timer=idle===null?window.setTimeout(warm,750):null;
  return()=>{active=false;if(idle!==null)window.cancelIdleCallback(idle);if(timer!==null)window.clearTimeout(timer);};
 },[identity,ended,data?.eligible,data?.inline_available,data?.preparation]);
 useEffect(()=>{
  if(ended&&data?.eligible&&data.inline_available&&!['processing','canceled'].includes(data.state)&&autoPrepared.current!==identity){autoPrepared.current=identity;setPreparedIdentity(identity);}
 },[ended,data?.eligible,data?.inline_available,data?.state,identity]);
 useEffect(()=>{if(paid||data?.state==='canceled'){setOpenIdentity(null);setPreparedIdentity(null);setArmedIdentity(null);}},[paid,data?.state]);
 useEffect(()=>{setMessage('');setError('');},[identity]);
 const run=async(action:'checkout'|'cancel'|'reconcile')=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  if(action==='cancel'){setOpenIdentity(null);setPreparedIdentity(null);setArmedIdentity(null);}
  try{
   const result=await ridePaymentAction(requestId,action);
   if(action==='checkout' && result.url){window.location.assign(result.url);return;}
   const current=await refresh();
   if(current.data&&['paid','refunded'].includes(current.data.payment_status)){setMessage('');return;}
   setMessage(result.state==='paid'?onlinePaymentLabel(result.environment??data?.environment,'paid'):action==='cancel'&&['canceled','none'].includes(result.state)?'Плати в брой на шофьора. Той ще потвърди получената сума.':'Проверяваме онлайн плащането. Изчакай потвърждението, преди да платиш в брой.');
  }catch(cause){setError(cause instanceof Error?cause.message:'Плащането не е потвърдено.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="w-full space-y-2" aria-label="Плащане по пътуването">
  <div className="flex items-center justify-between gap-3 text-sm"><span>{paid?'Платена сума':ended?'Дължима сума':'Цена на пътуването'}</span><strong className="text-xl tabular-nums">{money(data?.amount??price)}</strong></div>
  {testMode&&(data?.eligible||data?.payment_method==='online')&&<p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">Онлайн картата е в тестов режим · Не се теглят реални пари</p>}
  {paid?<p role="status" className="font-semibold text-primary-700">{data.payment_method==='online'?onlinePaymentLabel(data.environment,'paid'):data.payment_method==='card'?'Платено с карта на шофьора':'Платено в брой'}</p>:data?.payment_status==='refunded'?<p role="status">{data.payment_method==='online'?onlinePaymentLabel(data.environment,'refunded'):'Плащането е възстановено'}</p>:payment.isPending?<p role="status" className="text-sm">Проверяваме начините за плащане…</p>:data?.eligible?<>
   <button type="button" className="booking-primary w-full disabled:opacity-40" disabled={!ended || busy || payment.isError || data.state==='processing'} onClick={()=>{setMessage('');setError('');if(data.inline_available){setPreparedIdentity(identity);setArmedIdentity(identity);setOpenIdentity(identity);}else void run('checkout');}}>
    <i className="ri-bank-card-line" aria-hidden="true" />{busy?'Проверка…':data.state==='processing'?'Проверяваме плащането…':active&&!data.inline_available?'Продължи плащането':testMode?'Тествай плащане с карта':'Плати онлайн с карта'}
   </button>
   <button type="button" className="min-h-12 w-full rounded-xl border border-background-200 px-4 py-3 text-sm font-semibold disabled:opacity-40" disabled={!ended||busy||payment.isError} onClick={()=>void run('cancel')}>Плащане в брой</button>
   <p className="text-xs text-foreground-500">{ended?(testMode?'Само онлайн картата е тестова. Плащането в брой се отчита от шофьора като реално получена сума.':'С банкова карта, Apple Pay / Google Pay или в брой на шофьора.'):'Плащането се отключва, когато шофьорът отбележи края на пътуването.'}</p>
   {active&&<button type="button" className="min-h-11 text-xs underline" disabled={busy} onClick={()=>void run('reconcile')}>Провери плащането</button>}
  </>:ended&&data&&!payment.isError&&<p className="text-sm">Плати на шофьора. Онлайн плащането не е включено за този курс.</p>}
  {payment.isError&&<button type="button" className="min-h-11 text-xs underline" onClick={()=>void refresh()}>Обнови възможностите за плащане</button>}
  {message&&<p role="status" className="text-xs text-primary-700">{message}</p>}
  {error&&<p role="alert" className="booking-error">{error}</p>}
  {(preparedIdentity===identity||openIdentity===identity)&&user?.id&&data?.eligible&&data.inline_available&&<Suspense fallback={openIdentity===identity?<p role="status" className="text-sm">Зареждаме плащането…</p>:null}><RidePaymentElements key={`${identity}:${data.preparation?.account_id??''}:${data.preparation?.publishable_key??''}`} requestId={requestId} userId={user.id} open={openIdentity===identity} enabled={ended&&armedIdentity===identity} preparation={data.preparation??null} onClose={()=>setOpenIdentity(null)} onChanged={changed} /></Suspense>}
 </div>;
}

