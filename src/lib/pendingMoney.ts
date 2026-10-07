import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { isAmbiguousWrite } from './rideOperations';
export type MoneyCommand = { p_id: string; p_kind: string; p_amount: number; p_note: string; p_request_id?: string; p_reference_id?: string; p_source?: string; p_evidence_ref?: string };
type Intent = { owner: string; scope: string; command: MoneyCommand };
const key = (owner: string) => 'leski:pending-money:' + owner;
export function readMoneyIntent(owner: string): Intent | null {
 try {
  const raw = localStorage.getItem(key(owner));
  if (!raw) return null;
  const intent = JSON.parse(raw) as Intent;
  if (intent.owner !== owner || typeof intent.scope !== 'string' || !intent.command || typeof intent.command.p_id !== 'string'
   || !Number.isFinite(intent.command.p_amount) || typeof intent.command.p_note !== 'string'
   || !['income','expense','handover','confirmation','reversal'].includes(intent.command.p_kind)) throw new Error('Invalid pending entry');
  return intent;
 } catch { return null; }
}
export function prepareMoneyIntent(owner: string, scope: string, payload: Omit<MoneyCommand,'p_id'>): MoneyCommand {
 const existing = readMoneyIntent(owner);
 let stored: string | null;
 try { stored = localStorage.getItem(key(owner)); }
 catch { throw new Error('Разрешете съхранението за сайта, за да запазим безопасно финансовия запис.'); }
 if (stored && !existing) throw new Error('Запазеният непотвърден запис е повреден. Свържете се с поддръжката за сверяване, преди да добавяте нов.');
 if (existing) {
  const { p_id: _id, ...prior } = existing.command;
  if (existing.scope !== scope || JSON.stringify(prior) !== JSON.stringify(payload)) throw new Error('Първо проверете или повторете непотвърдения запис със същите данни.');
  return existing.command;
 }
 const command = { ...payload, p_id: crypto.randomUUID() };
 // Persist before writing. If storage is blocked, do not send a financial mutation.
 try { localStorage.setItem(key(owner), JSON.stringify({owner,scope,command})); }
 catch { throw new Error('Разрешете съхранението за сайта, за да запазим безопасно финансовия запис.'); }
 return command;
}
export function clearMoneyIntent(owner: string, id: string) {
 if (readMoneyIntent(owner)?.command.p_id === id) localStorage.removeItem(key(owner));
}
export async function findMoneyOperation(id: string, owner: string) {
 const {data,error} = await withRequestTimeout(signal => supabase.from('driver_money_entries').select('id,actor_id').eq('id',id).eq('actor_id',owner).abortSignal(signal).maybeSingle(),5000);
 if (error) throw error;
 return data?.id === id;
}
export async function writeMoneyOperation(command: MoneyCommand, owner: string) {
 try {
  const {data,error} = await withRequestTimeout(signal => supabase.rpc('record_driver_money_verified',{...command,p_actor:owner}).abortSignal(signal),15_000);
  if (error) throw error;
  if (data !== command.p_id) throw new Error('Записът не е потвърден.');
 } catch (cause) {
  if (!isAmbiguousWrite(cause)) throw cause;
  try { if (await findMoneyOperation(command.p_id,owner)) return; } catch { /* Retain the same persisted operation for an explicit retry. */ }
  throw new Error('Записът още не е потвърден. Проверете връзката и повторете със същите данни.');
 }
}
