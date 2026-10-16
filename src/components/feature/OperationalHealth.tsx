import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { healthNotices, operationLabels, type Health } from '@/lib/operationalHealth';
export default function OperationalHealth({companyId}:{companyId:string}) {
 const {user}=useAuth();
 const query=useQuery({queryKey:['operational-health',companyId],refetchInterval:60000,refetchIntervalInBackground:false,retry:1,queryFn:async({signal})=>{
  const {data,error}=await withRequestTimeout(abort=>supabase.rpc('operational_health',{p_company_id:companyId}).abortSignal(abort),8000,signal);
  if(error)throw error;return data as unknown as Health;
 }});
 const health=query.data,notices=health?healthNotices(health):[];
 return <section className="rounded-2xl border border-background-200 bg-white p-4 sm:p-5 mb-4" aria-label="Състояние на услугата">
  <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Всичко наред ли е с услугата?</h2><button className="min-h-11 px-2 text-sm underline disabled:opacity-40" disabled={query.isFetching} onClick={()=>void query.refetch()}>Обнови</button></div>
  {query.isError?<p role="alert" className="text-sm text-red-700">Проверката не е достъпна. Обнови, за да видиш състоянието.</p>:health?<>
   {notices.length?<ul className="space-y-3">{notices.map(a=><li key={a.key} className="rounded-xl bg-amber-50 p-3 text-amber-950"><p className="text-sm font-semibold">{a.title}</p><p className="mt-1 text-xs leading-relaxed text-amber-900">{a.detail}</p>{a.href&&<Link to={a.href} className="min-h-11 inline-flex items-center text-xs font-semibold underline">{a.action}</Link>}</li>)}</ul>:<p className="text-sm text-emerald-800">Няма открити проблеми по наблюдаваните показатели.</p>}
   <p className="mt-3 text-xs text-foreground-500">Проверено в {new Date(health.checked_at).toLocaleTimeString('bg-BG',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit'})} ч. · Локациите са към тази проверка; останалите сигнали обобщават последните 24 часа.</p>
   <details className="mt-2 text-xs"><summary className="min-h-11 flex items-center cursor-pointer text-foreground-600 font-medium">Какво е проверено</summary>
    <p className="mb-2">Наблюдаваме локациите на онлайн шофьорите, доставянето на известия и работата на заявките и маршрутите.</p>
    {health.metrics.map(m=><p className="mt-2" key={m.name}>{operationLabels[m.name]??'Друго действие'}: {m.count} опита · {m.errors} неуспешни · средно {(m.avg_ms/1000).toLocaleString('bg-BG',{maximumFractionDigits:1})} сек.</p>)}
    {!health.metrics.length&&<p>Все още няма наблюдения от устройствата.</p>}
    <p className="mt-3 text-foreground-500">Данните идват от устройства с връзка. Телефон без интернет може да не изпрати сигнал за проблем.</p>
   </details>
   {user?.role==='SUPER_ADMIN'&&<details className="mt-1 text-xs text-foreground-500"><summary className="min-h-11 flex items-center cursor-pointer">Технически данни за поддръжката</summary>
    {health.route_budget&&<p>Маршрутни заявки: {health.route_budget.used}/{health.route_budget.daily_limit} · резерв {health.route_budget.quote_reserve} · обновяване по {health.route_budget.timezone}.</p>}
    {health.company_routes?.map((r,i)=><p key={i}>{r.quoted?'Оферти':'Навигация'}: {r.reserved} заявки · {r.denied} ограничени.</p>)}
    {health.metrics.map(m=><p className="mt-1" key={m.name}>{m.name}: {m.errors}/{m.count} грешки · средно {m.avg_ms} ms · максимум {m.max_ms} ms</p>)}
   </details>}
  </>:<p role="status" className="text-sm">Проверка на услугата…</p>}
 </section>;
}
