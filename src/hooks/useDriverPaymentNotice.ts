import { onlinePaymentLabel } from '@/lib/ridePayment';
import { useEffect, useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import type { Tables } from '@/lib/database.types';
import { cacheDriverRequest } from '@/lib/driverRequestCache';
import { mergeRequestSnapshot } from '@/lib/requestSnapshot';
import { queryKeys } from '@/lib/queryKeys';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
/** Reuse the terminal server snapshot already delivered by Realtime. If that
 * event was missed, read the exact previous ride once; never poll idle drivers. */
export function useDriverPaymentReceipt(owner:string|undefined,driverId:string|undefined,requestId:string|undefined) {
 const client=useQueryClient();
 const [previous,setPrevious]=useState<{owner:string;driverId:string;requestId:string}|null>(null);
 useEffect(()=>{
  if(!owner||!driverId){setPrevious(null);return;}
  if(requestId)setPrevious({owner,driverId,requestId});
 },[owner,driverId,requestId]);
 const scoped=!!owner&&!!driverId&&previous?.owner===owner&&previous.driverId===driverId;
 const queryKey=queryKeys.driverRequestSnapshot(driverId??'none',scoped?previous.requestId:'none');
 const receipt=useQuery<Tables<'taxi_requests'>|null>({
  queryKey,
  enabled:scoped&&!requestId,staleTime:q=>q.state.data&&['completed','cancelled'].includes(q.state.data.status)?Infinity:0,retry:1,refetchOnWindowFocus:false,
  queryFn:async({signal})=>{
   if(!scoped)return null;
   const {data,error}=await withRequestTimeout(abort=>supabase.from('taxi_requests').select('*')
    .eq('id',previous.requestId).eq('driver_id',driverId).eq('payment_environment','live').abortSignal(abort).maybeSingle(),8000,signal);
   if(error)throw error;
   if(data&&(data.id!==previous.requestId||data.driver_id!==driverId))throw Error('Wrong ride receipt');
   const latest=client.getQueryData<Tables<'taxi_requests'>|null>(queryKey);
   const result=latest?(data?mergeRequestSnapshot(latest,data):latest):data;
   if(result)cacheDriverRequest(client,driverId!,result);
   return result;
  },
 });
 const row=receipt.data;
 return scoped&&!requestId&&row?.id===previous.requestId&&row.driver_id===driverId&&row.status==='completed'&&row.payment_status==='paid'&&row.payment_method==='online'&&row.payment_environment==='live'
  ?row:null;
}

export function useDriverPaymentNotice(owner:string|undefined,driverId:string|undefined,requestId:string|undefined) {
 const row=useDriverPaymentReceipt(owner,driverId,requestId);
 return row?onlinePaymentLabel(row.payment_environment,row.payment_status):'';
}
