import { onlinePaymentLabel } from '@/lib/ridePayment';
import { useEffect,useRef,useState } from 'react';
import { supabase } from '@/lib/supabase';
import { withRequestTimeout } from '@/lib/requestTimeout';
/** One final database read when a ride disappears also recovers a missed paid
 * event. No extra channel and no polling when the driver has no active ride. */
export function useDriverPaymentNotice(owner:string|undefined,driverId:string|undefined,requestId:string|undefined) {
 const previous=useRef<{owner:string;driverId:string;requestId:string}|null>(null);
 const [notice,setNotice]=useState<{owner:string;text:string}|null>(null);
 useEffect(()=>{
  if(!owner||!driverId){previous.current=null;return;}
  if(requestId){previous.current={owner,driverId,requestId};return;}
  const last=previous.current;previous.current=null;
  if(!last||last.owner!==owner||last.driverId!==driverId)return;
  const controller=new AbortController();
  void withRequestTimeout(signal=>supabase.from('taxi_requests').select('id,status,payment_status,payment_method,payment_environment').eq('id',last.requestId).eq('driver_id',driverId).abortSignal(signal).maybeSingle(),8000,controller.signal)
   .then(({data,error})=>{if(!controller.signal.aborted&&!error&&data?.status==='completed'&&data.payment_status==='paid'&&data.payment_method==='online')setNotice({owner,text:onlinePaymentLabel(data.payment_environment,data.payment_status)});}).catch(()=>{});
  return()=>controller.abort();
 },[owner,driverId,requestId]);
 return notice&&notice.owner===owner?notice.text:'';
}

