import { legalOperator } from '@/config/legal';
import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import type { SocialProvider } from './socialAuth';
const KEY='leski:oauth-legal-intent';
type Intent={terms:string;privacy:string;method:SocialProvider;created:number};
export function beginLegalIntent(provider: SocialProvider) {
 sessionStorage.setItem(KEY,JSON.stringify({terms:legalOperator.termsVersion,privacy:legalOperator.privacyVersion,method:provider,created:Date.now()}));
}
export function pendingLegalIntent(): Intent | null {
 try {
  const p=JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Intent | null;
  if (!p || p.terms!==legalOperator.termsVersion || p.privacy!==legalOperator.privacyVersion
   || !['google','facebook'].includes(p.method) || !Number.isFinite(p.created) || p.created>Date.now() || Date.now()-p.created>60*60*1000) return null;
  return p;
 } catch { return null; }
}
export async function acceptCurrentLegal(method: 'google'|'facebook'|'continue') {
 const {data,error}=await withRequestTimeout(signal=>supabase.rpc('accept_legal_versions',{
  p_terms:legalOperator.termsVersion,p_privacy:legalOperator.privacyVersion,p_method:method,
 }).abortSignal(signal),10_000);
 if (error) throw error;
 if (typeof data!=='string') throw new Error('Приемането на условията не е потвърдено.');
 return data;
}
export async function finishLegalIntent() {
 const intent=pendingLegalIntent(); if (!intent) return;
 await acceptCurrentLegal(intent.method);
 sessionStorage.removeItem(KEY);
}
