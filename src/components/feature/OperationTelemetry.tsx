import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { startOperationTelemetry } from '@/lib/operationTelemetry';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
export default function OperationTelemetry() {
 const {user}=useAuth();
 useEffect(()=>{
  if(!user?.id) return;
  return startOperationTelemetry(async(id,rows,signal)=>{
   const {data,error}=await withRequestTimeout(abort=>supabase.rpc('record_operation_metrics',{p_id:id,p_rows:rows}).abortSignal(abort),5000,signal);
   if(error) throw error; return data===true;
  });
 },[user?.id]);
 return null;
}
