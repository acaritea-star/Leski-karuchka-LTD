import { supabase } from './supabase';
import { invokeEdge,EdgeRequestError } from './edgeRequest';
import { withRequestTimeout } from './requestTimeout';
import type { Tables } from './database.types';
import { startRidePaymentTiming } from './ridePaymentTiming';
export type RidePaymentPreparation={account_id:string;publishable_key:string;environment:'live'|'test'};
export type RidePaymentState={request_id:string;eligible:boolean;inline_available?:boolean;preparation?:RidePaymentPreparation|null;environment:'live'|'test';ended_at:string|null;amount:number|null;state:string;payment_status:string;payment_method:string};
export type RideElementsSession={state:string;environment:'live'|'test';url?:string|null;ui_mode:'elements';request_id:string;session_id:string;account_id:string;amount_minor:number;currency:'eur';publishable_key:string;client_secret:string};
export type RidePaymentResult={state:string;url?:string|null;environment?:'live'|'test'};
const states=['none','creating','open','processing','canceled','paid','partially_refunded','refunded'];
export async function loadRidePayment(requestId:string,signal?:AbortSignal):Promise<RidePaymentState> {
 const {data,error}=await withRequestTimeout(abort=>supabase.rpc('ride_payment_state',{p_request_id:requestId}).abortSignal(abort),8000,signal);
 if(error)throw error;
 const value=data as unknown as RidePaymentState;
 if(!value || value.inline_available!==undefined && typeof value.inline_available!=='boolean' || value.environment!==undefined && !['live','test'].includes(value.environment) || value.request_id!==requestId || typeof value.eligible!=='boolean' || !states.includes(value.state) || !['pending','paid','refunded'].includes(value.payment_status) || !['cash','card','online'].includes(value.payment_method) ||
  value.amount!==null && (typeof value.amount!=='number' || !Number.isFinite(value.amount) || value.amount<0) ||
  value.ended_at!==null && (typeof value.ended_at!=='string'||!Number.isFinite(Date.parse(value.ended_at))))throw Error('Плащането не може да бъде проверено.');
 const preparation=value.preparation;
 if(preparation&&(!value.eligible||!value.inline_available||preparation.environment!==value.environment||
  typeof preparation.account_id!=='string'||!/^acct_[a-zA-Z0-9]+$/.test(preparation.account_id)||typeof preparation.publishable_key!=='string'||
  !(value.environment==='live'?/^pk_live_[a-zA-Z0-9]+$/:/^pk_test_[a-zA-Z0-9]+$/).test(preparation.publishable_key)))throw Error('Платежната конфигурация не може да бъде проверена.');
 return {...value,environment:value.environment??'live'};
}
export async function endRideTrip(requestId:string,driverId:string):Promise<Tables<'taxi_requests'>> {
 const {data,error}=await withRequestTimeout(signal=>supabase.rpc('end_ride_trip',{p_request_id:requestId}).abortSignal(signal),12000);
 if(error)throw error;
 const ride=data as unknown as Tables<'taxi_requests'>;
 if(!ride || ride.id!==requestId || ride.driver_id!==driverId || !ride.trip_ended_at || ride.final_price!==ride.estimated_price)throw Error('Краят на пътуването не е потвърден. Обнови курса и опитай отново.');
 return ride;
}
export async function ridePaymentAction(requestId:string,action:'checkout'|'cancel'|'reconcile'|'elements',signal?:AbortSignal):Promise<RidePaymentResult|RideElementsSession> {
 const finishTiming=action==='reconcile'?startRidePaymentTiming('reconcile'):()=>{};
 const {data,error}=await invokeEdge<RidePaymentResult & Partial<RideElementsSession>>('ride-checkout',{request_id:requestId,action},22000,signal);
 finishTiming();
 if(error)throw Error(error instanceof EdgeRequestError && error.code==='PAYMENT_NOT_ALLOWED'?'Онлайн плащането още не е достъпно за този курс.':'Потвърждението се забави. Провери плащането преди да опиташ друг начин.');
 if(!data || !states.includes(data.state))throw Error('Няма проверено състояние на плащането.');
 if(data.url) {
  const url=new URL(data.url);
  if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com' || url.username || url.password)throw Error('Невалидна връзка за плащане.');
 }
 if(action==='elements' && data.ui_mode==='elements')return parseRideElementsSession(data,requestId);
 return data;
}

export function parseRideElementsSession(value:unknown,requestId:string):RideElementsSession {
 const v=value as RideElementsSession,live=v?.environment==='live';
 if(!v || v.ui_mode!=='elements' || v.state!=='open' || !['live','test'].includes(v.environment) || v.request_id!==requestId ||
  typeof v.account_id!=='string' || !/^acct_[a-zA-Z0-9]+$/.test(v.account_id) || typeof v.session_id!=='string' ||
  !(live?/^cs_live_[a-zA-Z0-9]+$/:/^cs_test_[a-zA-Z0-9]+$/).test(v.session_id) ||
  typeof v.publishable_key!=='string' || !(live?/^pk_live_[a-zA-Z0-9]+$/:/^pk_test_[a-zA-Z0-9]+$/).test(v.publishable_key) ||
  typeof v.client_secret!=='string' || !v.client_secret.startsWith(`${v.session_id}_secret_`) ||
  !Number.isSafeInteger(v.amount_minor) || v.amount_minor<=0 || v.amount_minor>100000000 || v.currency!=='eur')throw Error('Платежната сесия не може да бъде проверена.');
 return v;
}

export function paymentPreferenceKey(userId:string,accountId:string,environment:string) {return `ride-pay-method:${userId}:${accountId}:${environment}`;}
export function preferredPaymentMethod(key:string):'wallet'|'card' {
 try{return localStorage.getItem(key)==='card'?'card':'wallet';}catch{return 'wallet';}
}
export function rememberPaymentMethod(key:string,method:'wallet'|'card') {try{localStorage.setItem(key,method);}catch{/* Storage is optional. Card details stay in Stripe. */}}


export function onlinePaymentLabel(environment:string|undefined,status:string|undefined) {
 if(environment==='test')return 'Архивиран запис';
 return status==='refunded'?'Възстановено онлайн':status==='paid'?'Платено онлайн':'Онлайн плащане';
}
