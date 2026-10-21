import { useEffect,useRef,useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { loadRidePayment,ridePaymentAction } from '@/lib/ridePayment';
import { money } from '@/lib/accounting';
export default function CustomerRidePayment({requestId,price,endedAt,revision}:{requestId:string;price:number|null;endedAt?:string|null;revision?:string}) {
 const {user}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');const lock=useRef(false);
 const payment=useQuery({queryKey:['ride-payment-state',user?.id,requestId],enabled:!!user?.id,
  queryFn:({signal})=>loadRidePayment(requestId,signal),retry:1,staleTime:10000,
  refetchInterval:q=>q.state.data?.ended_at && ['creating','open','processing'].includes(q.state.data.state)?10000:false,
  refetchIntervalInBackground:false});
 const refresh=payment.refetch;
 useEffect(()=>{void refresh();},[revision,refresh]);
 const data=payment.data,ended=!!endedAt || !!data?.ended_at;
 const paid=data?.payment_status==='paid' && data.payment_method==='online';
 const active=!!data && ['creating','open','processing'].includes(data.state);
 const run=async(action:'checkout'|'cancel'|'reconcile')=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
  try{
   const result=await ridePaymentAction(requestId,action);await refresh();
   if(action==='checkout' && result.url)window.location.assign(result.url);
   else setMessage(result.state==='paid'?'Платено онлайн':result.state==='canceled'?'Онлайн плащането е отменено. Можеш да платиш в брой на шофьора.':'Проверяваме плащането…');
  }catch(cause){setError(cause instanceof Error?cause.message:'Плащането не е потвърдено.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="w-full space-y-2" aria-label="Плащане по пътуването">
  <div className="flex items-center justify-between gap-3 text-sm"><span>{ended?'Дължима сума':'Цена на пътуването'}</span><strong className="text-xl tabular-nums">{money(data?.amount??price)}</strong></div>
  {paid?<p role="status" className="font-semibold text-primary-700">Платено онлайн</p>:data?.eligible?<>
   <button type="button" className="booking-primary w-full disabled:opacity-40" disabled={!ended || busy || payment.isError || data.state==='processing'} onClick={()=>void run('checkout')}>
    <i className="ri-bank-card-line" aria-hidden="true" />{busy?'Проверка…':data.state==='processing'?'Проверяваме плащането…':active?'Продължи плащането':'Плати онлайн с карта'}
   </button>
   <p className="text-xs text-foreground-500">{ended?'Apple Pay и други налични методи през Stripe. Можеш да платиш и в брой.':'Плащането се отключва, когато шофьорът отбележи края на пътуването.'}</p>
   {active&&<div className="flex flex-wrap gap-x-4 text-xs"><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void run('reconcile')}>Провери плащането</button><button type="button" className="min-h-11 underline" disabled={busy} onClick={()=>void run('cancel')}>Премини към плащане в брой</button></div>}
  </>:ended&&<p className="text-sm">Плати на шофьора. Онлайн плащането не е включено за този курс.</p>}
  {payment.isError&&<button type="button" className="min-h-11 text-xs underline" onClick={()=>void refresh()}>Обнови възможностите за плащане</button>}
  {message&&<p role="status" className="text-xs text-primary-700">{message}</p>}
  {error&&<p role="alert" className="booking-error">{error}</p>}
 </div>;
}
