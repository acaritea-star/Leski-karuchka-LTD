import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { healthAlerts, type Health } from '@/lib/operationalHealth';
export default function OperationalHealth({companyId}:{companyId:string}) {
 const query=useQuery({queryKey:['operational-health',companyId],refetchInterval:60000,refetchIntervalInBackground:false,retry:1,queryFn:async({signal})=>{
  const {data,error}=await withRequestTimeout(abort=>supabase.rpc('operational_health',{p_company_id:companyId}).abortSignal(abort),8000,signal);
  if(error)throw error;return data as unknown as Health;
 }});
 return <section className="rounded-xl border border-background-100 bg-white p-4 mb-4" aria-label="Надеждност на услугата">
  <div className="flex justify-between gap-3"><h2 className="font-semibold">Надеждност на услугата</h2><button className="text-xs underline" disabled={query.isFetching} onClick={()=>void query.refetch()}>Обнови</button></div>
  {query.isError?<p role="alert" className="text-sm text-red-600">Проверката не е достъпна. Не можем да потвърдим текущото състояние.</p>:query.data?<>
   <p className="text-xs text-foreground-500 my-2">Последна проверка: {new Date(query.data.checked_at).toLocaleTimeString('bg-BG')}. Показани са наблюденията за тази фирма за 24 часа.</p>
   {healthAlerts(query.data).length?<ul className="text-sm text-amber-700 space-y-1">{healthAlerts(query.data).map(a=><li key={a}>{a}</li>)}</ul>:<p className="text-sm">Няма активни сигнали по тези показатели.</p>}
   {query.data.route_budget&&<p className="text-xs mt-2">Маршрути: {query.data.route_budget.used}/{query.data.route_budget.daily_limit} · Резерв за поръчки: {query.data.route_budget.quote_reserve} · До {query.data.route_budget.ride_limit} заявки за маршрут на курс. Бюджетът се обновява в полунощ по {query.data.route_budget.timezone}.</p>}
   {query.data.company_routes?.map(r=><p key={String(r.quoted)} className="text-xs mt-1">{r.quoted?'Оферти':'Навигация'} за фирмата днес: {r.reserved} резервирани маршрутни заявки · {r.denied} спрени от лимита. Това са извиквания, не брой курсове.</p>)}
   <details className="mt-2 text-xs"><summary className="cursor-pointer">Времена и грешки на операциите</summary>
    {!query.data.metrics.length&&<p className="mt-2">Все още няма получени диагностични данни.</p>}
    {query.data.metrics.map(m=><p className="mt-1" key={m.name}>{m.name}: {m.count} операции · {m.errors} грешки · средно {m.avg_ms} ms · максимум {m.max_ms} ms</p>)}
    <p className="mt-2">Диагностиката е от устройства с връзка и не обхваща всяко прекъсване. Не замества външно наблюдение.</p>
   </details>
  </>:<p className="text-sm">Проверка…</p>}
 </section>;
}
