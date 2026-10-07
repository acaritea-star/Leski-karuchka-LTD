import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { legalOperator } from '@/config/legal';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { acceptCurrentLegal } from '@/lib/legalAcceptance';
export default function LegalAcceptanceNotice() {
 const {user}=useAuth(); const client=useQueryClient(); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
 const key=['legal-acceptance',user?.id,legalOperator.termsVersion,legalOperator.privacyVersion];
 const query=useQuery({queryKey:key,enabled:!!user?.id,staleTime:Infinity,retry:1,queryFn:async({signal})=>{
  const {data,error}=await withRequestTimeout(abort=>supabase.from('legal_acceptances').select('id').eq('user_id',user!.id)
   .eq('terms_version',legalOperator.termsVersion).eq('privacy_version',legalOperator.privacyVersion).abortSignal(abort).maybeSingle(),10_000,signal);
  if(error)throw error; return data;
 }});
 if(!user || query.isPending || query.data) return null;
 const accept=async()=>{if(busy)return;setBusy(true);setError('');try{
  const id=await acceptCurrentLegal('continue'); client.setQueryData(key,{id});
 }catch{setError('Потвърждението още не е записано. Опитайте отново.');}finally{setBusy(false);}};
 return <aside className="fixed bottom-4 left-4 right-4 z-[70] mx-auto max-w-lg rounded-xl border border-background-200 bg-white p-4 shadow-lg" aria-label="Условия и поверителност">
  <p className="text-xs text-foreground-700">С „Продължи“ приемате <Link to="/terms" className="underline">Общите условия</Link> и потвърждавате, че сте запознати с <Link to="/privacy" className="underline">Политиката за поверителност</Link>. Това не е съгласие за реклама.</p>
  {(error||query.isError)&&<p role="alert" className="text-xs text-red-600 mt-2">{error||'Проверката се забави. Обновете я.'}</p>}
  <button disabled={busy} onClick={()=>void(query.isError?query.refetch():accept())} className="mt-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Запазване…':query.isError?'Опитай отново':'Продължи'}</button>
 </aside>;
}
