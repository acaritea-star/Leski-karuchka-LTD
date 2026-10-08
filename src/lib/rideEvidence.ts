import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export interface RideEvidence {
 samples:number; good_samples:number; approach_meters:number; trip_meters:number;
 observed_seconds:number; stationary_seconds:number; flags:string[]; customer_confirmed_at:string|null;
}
export const evidenceFlagLabels: Record<string,string>={
 poor_accuracy:'Неточен GPS',clock_skew:'Разлика в часовника на устройството',gps_jump:'Необичаен скок на GPS',gps_gap:'Прекъсване на GPS',
 arrived_gps_unavailable:'Без надежден GPS при пристигане',in_progress_gps_unavailable:'Без надежден GPS при начало',completed_gps_unavailable:'Без надежден GPS при край',
 arrived_far_from_stop:'Пристигане далеч от началната точка',in_progress_far_from_stop:'Начало далеч от началната точка',completed_far_from_stop:'Край далеч от дестинацията',
 implausible_duration:'Необичайно кратко пътуване',insufficient_gps:'Недостатъчно GPS наблюдения',
};
export const evidenceDescription=(e:RideEvidence)=>e.good_samples<2?'Недостатъчно GPS данни':
 `Наблюдавано по GPS: ${(e.approach_meters/1000).toFixed(2)} км до клиента · ${(e.trip_meters/1000).toFixed(2)} км в курса`;
export async function confirmRideStart(requestId:string) {
 const {data,error}=await withRequestTimeout(signal=>supabase.rpc('confirm_ride_start',{p_request_id:requestId}).abortSignal(signal),10000);
 if(error) throw error;
 if(typeof data!=='string') throw new Error('Потвърждението не е записано.');
 return data;
}
