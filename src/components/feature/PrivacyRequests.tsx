import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
const labels:Record<string,string>={pending:'Получено',in_progress:'В обработка',completed:'Изпълнено',rejected:'Отказ с основание'};
export default function PrivacyRequests({admin=false}:{admin?:boolean}) {
 const {user}=useAuth();const client=useQueryClient();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const [deleting,setDeleting]=useState(false);const [notes,setNotes]=useState<Record<string,string>>({});
 const query=useQuery({queryKey:['privacy-requests',user?.id,admin],enabled:!!user?.id,staleTime:30_000,queryFn:async({signal})=>{
  let q=supabase.from('privacy_requests').select('*').order('created_at',{ascending:admin}).order('id',{ascending:admin}).limit(20);
  if(admin)q=q.in('status',['pending','in_progress']);
  if(!admin)q=q.eq('user_id',user!.id);
  const {data,error}=await withRequestTimeout(abort=>q.abortSignal(abort),10_000,signal);if(error)throw error;return data??[];
 }});
 const action=async(kind:'export'|'deletion')=>{
  if(busy)return;setBusy(true);setMessage('');
  try{const {data,error}=await withRequestTimeout(signal=>supabase.rpc('request_personal_data',{p_kind:kind}).abortSignal(signal));if(error)throw error;
   setMessage('Искането е получено. Номер: '+data+'. То ще бъде обработено индивидуално.');setDeleting(false);await client.invalidateQueries({queryKey:['privacy-requests']});
  }catch{setMessage('Искането още не е потвърдено. Можете да повторите безопасно.');}finally{setBusy(false);}
 };
 const download=async()=>{
  if(busy)return;setBusy(true);setMessage('');
  try{const {data,error}=await withRequestTimeout(signal=>supabase.rpc('export_my_basic_data').abortSignal(signal));if(error)throw error;
   const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='leski-my-data.json';a.click();URL.revokeObjectURL(url);
  }catch{setMessage('Данните не се изтеглиха. Опитайте отново.');}finally{setBusy(false);}
 };
 const resolve=async(id:string,status:'in_progress'|'completed'|'rejected')=>{
  const note=notes[id]?.trim();if(!note||busy)return;setBusy(true);setMessage('');
  try{const {error}=await withRequestTimeout(signal=>supabase.rpc('resolve_privacy_request',{p_id:id,p_status:status,p_note:note}).abortSignal(signal));if(error)throw error;await query.refetch();}
  catch{setMessage('Статусът не е потвърден. Обновете списъка.');}finally{setBusy(false);}
 };
 if(!user)return null;
 return <section className="bg-white rounded-2xl p-4 mt-4 space-y-3" aria-label="Лични данни">
  <h2 className="text-sm font-semibold text-foreground-950">{admin?'Искания за лични данни':'Моите лични данни'}</h2>
  {admin&&<p className="text-xs text-foreground-500">Показани са най-старите 20 отворени искания. След приключване на искане се зареждат следващите.</p>}
  {!admin&&<><p className="text-xs text-foreground-500">Можете да изтеглите основните данни на профила (до 1000 записа на списък) или да поискате пълно копие. Искането за изтриване се обработва индивидуално; тук следите статуса му.</p>
   <div className="flex flex-wrap gap-3 text-sm"><button disabled={busy} className="text-primary-600 underline" onClick={()=>void download()}>Изтегли основните ми данни</button>
    <button disabled={busy} className="text-primary-600 underline" onClick={()=>void action('export')}>Поискай пълно копие</button>
    <button disabled={busy} className="text-foreground-600 underline" onClick={()=>setDeleting(true)}>Поискай изтриване</button></div>
   {deleting&&<div className="text-xs space-y-2"><p>Подавате искане за закриване и изтриване. Администраторът ще провери кои данни могат да се изтрият и кои подлежат на законово съхранение.</p>
    <button disabled={busy} className="text-primary-600 underline mr-4" onClick={()=>void action('deletion')}>Потвърди искането</button><button onClick={()=>setDeleting(false)}>Откажи</button></div>}</>}
  {message&&<p role="status" className="text-xs text-foreground-700 break-words">{message}</p>}
  {query.isError&&<button className="text-sm underline" onClick={()=>void query.refetch()}>Обнови исканията</button>}
  {query.data?.map(r=><article key={r.id} className="border-t border-background-100 pt-2 text-xs space-y-1">
   <p>{r.kind==='deletion'?'Изтриване':'Пълно копие'} · {labels[r.status]} · {new Date(r.created_at).toLocaleDateString('bg-BG')}</p>
   <p className="text-foreground-500 break-words">Номер: {r.id}{r.resolution&&<> · {r.resolution}</>}</p>
   {admin&&<p className="text-foreground-500 break-words">Профил: {r.user_id}</p>}
   {admin&&['pending','in_progress'].includes(r.status)&&<><p className="text-foreground-500">Отбележете „Изпълнено“ след действителното изпълнение и проверка.</p>
    <input className="w-full rounded-lg border border-background-200 p-2" aria-label={'Резултат '+r.id} maxLength={1000} value={notes[r.id]??''} onChange={e=>setNotes({...notes,[r.id]:e.target.value})}/>
    <div className="flex gap-3">{(['in_progress','completed','rejected'] as const).map(s=><button key={s} disabled={busy||!notes[r.id]?.trim()} className="text-primary-600 underline disabled:opacity-50" onClick={()=>void resolve(r.id,s)}>{labels[s]}</button>)}</div></>}
  </article>)}
 </section>;
}
