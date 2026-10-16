import { supabase } from './supabase';
import { isAmbiguousWrite } from './rideOperations';
import { withRequestTimeout } from './requestTimeout';
import type { Tables } from './database.types';
export type ExpenseReceipt = Tables<'expense_receipts'>;
const bucket = 'expense-receipts';
const mimeTypes = ['image/jpeg','image/png','image/webp','application/pdf'];
const intentKey = (owner: string, entry: string) => `leski:expense-receipt:${owner}:${entry}`;
type Upload = { p_id:string;p_entry_id:string;p_actor:string;p_file_name:string;p_mime_type:string;p_byte_size:number;p_digest:string };
export async function listExpenseReceipts(entry: string, signal?: AbortSignal): Promise<ExpenseReceipt[]> {
 const { data, error } = await withRequestTimeout(abort => supabase.from('expense_receipts').select('*').eq('entry_id',entry).order('slot').limit(3).abortSignal(abort), 8000, signal);
 if (error) throw error;
 return data ?? [];
}
function receipt(value: unknown, id: string, entry?: string): ExpenseReceipt {
 const r = value as ExpenseReceipt | null;
 if (!r || r.id !== id || entry && r.entry_id !== entry || !mimeTypes.includes(r.mime_type) || r.byte_size <= 0 || r.byte_size > 5242880 ||
  r.path !== `${r.company_id}/${r.driver_id}/${r.entry_id}/${r.id}.${({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf' } as Record<string,string>)[r.mime_type]}`) throw new Error('Документът не е потвърден.');
 return r;
}
export async function finalizeExpenseReceipt(id: string, owner: string): Promise<ExpenseReceipt> {
 const {data,error} = await withRequestTimeout(signal => supabase.rpc('finalize_expense_receipt',{p_id:id,p_actor:owner}).abortSignal(signal),10_000);
 if (error) throw error;
 const r = receipt(data,id);
 if (!r.uploaded_at) throw new Error('Документът още не е потвърден.');
 try {
  const key = intentKey(owner,r.entry_id), stored = JSON.parse(localStorage.getItem(key) ?? 'null');
  if (stored?.p_id === id) localStorage.removeItem(key);
 } catch { /* Uploaded proof remains confirmed on the server. */ }
 return r;
}
export async function uploadExpenseReceipt(entry: string, owner: string, file: File): Promise<ExpenseReceipt> {
 if (!mimeTypes.includes(file.type) || file.size <= 0 || file.size > 5242880) throw new Error('Избери JPG, PNG, WebP или PDF до 5 MB.');
 const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(x => x.toString(16).padStart(2,'0')).join('');
 const payload = {p_entry_id:entry,p_actor:owner,p_file_name:file.name.slice(0,160),p_mime_type:file.type,p_byte_size:file.size,p_digest:digest};
 let upload: Upload;
 try {
  const key = intentKey(owner,entry), prior = JSON.parse(localStorage.getItem(key) ?? 'null') as Upload | null;
  if (prior) {
   const {p_id:_id,...oldPayload} = prior;
   if (typeof prior.p_id !== 'string' || JSON.stringify(oldPayload) !== JSON.stringify(payload)) throw new Error('Първо довърши непотвърденото качване със същия файл.');
   upload = prior;
  } else {
   upload = {...payload,p_id:crypto.randomUUID()};
   localStorage.setItem(key,JSON.stringify(upload));
  }
 } catch (cause) { throw new Error(cause instanceof Error && cause.message.startsWith('Първо') ? cause.message : 'Разреши съхранението за сайта, за да качиш документа безопасно.'); }
 const {data,error} = await withRequestTimeout(signal => supabase.rpc('reserve_expense_receipt',upload).abortSignal(signal),10_000);
 if (error) {
  if (!isAmbiguousWrite(error)) { try { if (JSON.parse(localStorage.getItem(intentKey(owner,entry)) ?? 'null')?.p_id === upload.p_id) localStorage.removeItem(intentKey(owner,entry)); } catch { /* Keep uncertain local state. */ } }
  throw error;
 }
 const r = receipt(data,upload.p_id,entry);
 if (r.uploaded_at) return finalizeExpenseReceipt(r.id,owner);
 // A timeout/duplicate can mean the immutable object already exists. Finalize
 // only that same reserved path; never create another expense or overwrite it.
 try { const result = await withRequestTimeout(() => supabase.storage.from(bucket).upload(r.path,file,{upsert:false,contentType:file.type,cacheControl:'0'}),30_000); if (result.error) throw result.error; }
 catch { /* Reconcile the existing reserved object below. */ }
 try { return await finalizeExpenseReceipt(r.id,owner); }
 catch { throw new Error('Разходът е записан. Качването на документа не е потвърдено. Провери го или избери същия файл отново.'); }
}
export async function downloadExpenseReceipt(r: ExpenseReceipt): Promise<Blob> {
 receipt(r,r.id);
 if (!r.uploaded_at) throw new Error('Качването още не е потвърдено.');
 const {data,error} = await withRequestTimeout(() => supabase.storage.from(bucket).download(r.path),15_000);
 if (error) throw error;
 if (!data || data.size !== r.byte_size || data.type !== r.mime_type) throw new Error('Документът не може да бъде проверен.');
 return data;
}
