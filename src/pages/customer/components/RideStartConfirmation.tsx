import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
import { confirmRideStart } from '@/lib/rideEvidence';
export default function RideStartConfirmation({requestId}:{requestId:string}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState(''); const lock=useRef(false);const client=useQueryClient();
 const key=['ride-start-confirmation',requestId];
 const query=useQuery({queryKey:key,staleTime:30000,retry:1,queryFn:async({signal})=>{
  const {data,error}=await withRequestTimeout(abort=>supabase.from('ride_evidence').select('customer_confirmed_at').eq('request_id',requestId).abortSignal(abort).maybeSingle(),8000,signal);
  if(error)throw error;return data?.customer_confirmed_at ?? null;
 }});
 const confirm=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{const at=await confirmRideStart(requestId);client.setQueryData(key,at);}
  catch{setError('Потвърждението не е получено. Опитайте отново.');}
  finally{lock.current=false;setBusy(false);}
 };
 return <div className="text-xs text-foreground-600 mt-2">
  {query.data?<p role="status">Потвърдихте, че пътуването е започнало.</p>:<>
   <p>Вече сте в автомобила и пътувате?</p>
   <button type="button" className="booking-secondary mt-2" disabled={busy} onClick={()=>void confirm()}>{busy?'Запазване…':'Потвърди начало'}</button>
   <p className="mt-1">Потвърждава само началото, без плащане.</p>
  </>}
  {error&&<p role="alert" className="booking-error">{error}</p>}
 </div>;
}
