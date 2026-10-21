import { supabase } from './supabase';
import { invokeEdge,EdgeRequestError } from './edgeRequest';
import { withRequestTimeout } from './requestTimeout';
import type { Tables } from './database.types';
export type RidePaymentState={request_id:string;eligible:boolean;environment:'live'|'test';ended_at:string|null;amount:number|null;state:string;payment_status:string;payment_method:string};
const states=['none','creating','open','processing','canceled','paid','partially_refunded','refunded'];
export async function loadRidePayment(requestId:string,signal?:AbortSignal):Promise<RidePaymentState> {
 const {data,error}=await withRequestTimeout(abort=>supabase.rpc('ride_payment_state',{p_request_id:requestId}).abortSignal(abort),8000,signal);
 if(error)throw error;
 const value=data as unknown as RidePaymentState;
 if(!value || value.environment!==undefined && !['live','test'].includes(value.environment) || value.request_id!==requestId || typeof value.eligible!=='boolean' || !states.includes(value.state) || !['pending','paid','refunded'].includes(value.payment_status) || !['cash','card','online'].includes(value.payment_method) ||
  value.amount!==null && (typeof value.amount!=='number' || !Number.isFinite(value.amount) || value.amount<0) ||
  value.ended_at!==null && (typeof value.ended_at!=='string'||!Number.isFinite(Date.parse(value.ended_at))))throw Error('Плащането не може да бъде проверено.');
 return {...value,environment:value.environment??'live'};
}
export async function endRideTrip(requestId:string,driverId:string):Promise<Tables<'taxi_requests'>> {
 const {data,error}=await withRequestTimeout(signal=>supabase.rpc('end_ride_trip',{p_request_id:requestId}).abortSignal(signal),12000);
 if(error)throw error;
 const ride=data as unknown as Tables<'taxi_requests'>;
 if(!ride || ride.id!==requestId || ride.driver_id!==driverId || !ride.trip_ended_at || ride.final_price!==ride.estimated_price)throw Error('Краят на пътуването не е потвърден. Обнови курса и опитай отново.');
 return ride;
}
export async function ridePaymentAction(requestId:string,action:'checkout'|'cancel'|'reconcile') {
 const {data,error}=await invokeEdge<{state:string;url?:string|null}>('ride-checkout',{request_id:requestId,action},22000);
 if(error)throw Error(error instanceof EdgeRequestError && error.code==='PAYMENT_NOT_ALLOWED'?'Онлайн плащането още не е достъпно за този курс.':'Потвърждението се забави. Провери плащането преди да опиташ друг начин.');
 if(!data || !states.includes(data.state))throw Error('Няма проверено състояние на плащането.');
 if(data.url) {
  const url=new URL(data.url);
  if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com' || url.username || url.password)throw Error('Невалидна връзка за плащане.');
 }
 return data;
}


export function onlinePaymentLabel(environment:string|undefined,status:string|undefined) {
 if(environment==='test')return status==='refunded'?'Тестово възстановяване':status==='paid'?'Тестово плащане успешно':'Тестово онлайн плащане';
 return status==='refunded'?'Възстановено онлайн':status==='paid'?'Платено онлайн':'Онлайн плащане';
}
