import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
export type Carrier = { id:string; name:string; legal_name:string|null; registration_id:string|null; address:string|null; phone:string|null; permit_number:string|null; permit_expires_on:string|null; verified:boolean };
export async function loadCarrier(companyId: string, signal?: AbortSignal): Promise<Carrier|null> {
 const {data,error}=await withRequestTimeout(abort=>supabase.rpc('carrier_identity',{p_company:companyId}).abortSignal(abort),10_000,signal);
 if (error) throw error;
 if (!data || typeof data!=='object' || Array.isArray(data) || !('id' in data) || data.id!==companyId || !('name' in data) || typeof data.name!=='string') return null;
 return data as unknown as Carrier;
}
export const documentExpired=(date:string|null|undefined,now=new Date())=>{
 if (!date) return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const today=['year','month','day'].map(type=>parts.find(p=>p.type===type)!.value).join('-');
 return date<today;
};
