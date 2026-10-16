import { supabase } from './supabase';
import { withRequestTimeout } from './requestTimeout';
import { isAmbiguousWrite } from './rideOperations';
import type { Tables } from './database.types';
export type PaymentChoice = 'cash' | 'card' | 'unpaid' | 'partial_cash' | 'partial_card';
export type CheckoutCommand = { p_id: string; p_request_id: string; p_actor: string; p_choice: PaymentChoice; p_partial_amount: number | null; p_note: string };
type Intent = { driverId: string; command: CheckoutCommand };
const key = (owner: string) => `leski:ride-checkout:${owner}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function readCheckout(owner: string): Intent | null {
 const raw = localStorage.getItem(key(owner));
 if (!raw) return null;
 try {
  const i = JSON.parse(raw) as Intent, c = i.command;
  if (!uuid.test(i.driverId) || !c || c.p_actor !== owner || !uuid.test(c.p_id) || !uuid.test(c.p_request_id) ||
   !['cash','card','unpaid','partial_cash','partial_card'].includes(c.p_choice) || typeof c.p_note !== 'string' || c.p_note.length > 500 ||
   (c.p_choice.startsWith('partial_') ? typeof c.p_partial_amount !== 'number' || !Number.isFinite(c.p_partial_amount) || c.p_partial_amount <= 0 || Number(c.p_partial_amount.toFixed(2)) !== c.p_partial_amount : c.p_partial_amount !== null)) throw new Error();
  return i;
 } catch { throw new Error('Непотвърденото плащане не може да се прочете. Свържи се с поддръжката преди нов запис.'); }
}
export function prepareCheckout(driverId: string, payload: Omit<CheckoutCommand, 'p_id'>): CheckoutCommand {
 const previous = readCheckout(payload.p_actor);
 if (previous) {
  const { p_id: _id, ...prior } = previous.command;
  if (previous.driverId !== driverId || JSON.stringify(prior) !== JSON.stringify(payload)) throw new Error('Първо провери непотвърденото плащане.');
  return previous.command;
 }
 const command = { ...payload, p_id: crypto.randomUUID() };
 try { localStorage.setItem(key(payload.p_actor), JSON.stringify({ driverId, command })); }
 catch { throw new Error('Разреши съхранението за сайта, за да запишем плащането безопасно.'); }
 return command;
}
export function clearCheckout(command: CheckoutCommand) {
 try { if (readCheckout(command.p_actor)?.command.p_id === command.p_id) localStorage.removeItem(key(command.p_actor)); } catch { /* Keep an unreadable intent for support. */ }
}
function verified(value: unknown, command: CheckoutCommand, driverId: string): Tables<'taxi_requests'> {
 if (!value || typeof value !== 'object' || !('receipt' in value) || !('ride' in value)) throw new Error('Липсва потвърждение за плащането.');
 const { receipt: r, ride } = value as {receipt: Tables<'ride_payment_receipts'>; ride: Tables<'taxi_requests'>};
 if (!r || !ride || r.id !== command.p_id || r.request_id !== command.p_request_id || r.driver_user_id !== command.p_actor || r.driver_id !== driverId ||
  r.choice !== command.p_choice || r.partial_amount !== command.p_partial_amount || r.note !== command.p_note ||
  ride.id !== r.request_id || ride.status !== 'completed' || ride.driver_id !== driverId || ride.company_id !== r.company_id ||
  r.expected_amount !== ride.final_price || !Number.isFinite(r.expected_amount) || r.expected_amount < 0 ||
  r.received_amount !== (command.p_choice === 'unpaid' ? 0 : command.p_partial_amount ?? r.expected_amount) ||
  r.payment_method !== (command.p_choice === 'unpaid' ? null : command.p_choice.replace('partial_', '')) ||
  (r.received_amount > 0 ? r.entry_id !== r.id : r.entry_id !== null)) throw new Error('Курсът и плащането не са потвърдени заедно. Провери записа.');
 return ride;
}
export async function findCheckout(command: CheckoutCommand, driverId: string): Promise<Tables<'taxi_requests'> | null> {
 const receipt = await withRequestTimeout(signal => supabase.from('ride_payment_receipts').select('*').eq('id', command.p_id).eq('driver_user_id', command.p_actor).abortSignal(signal).maybeSingle(), 5000);
 if (receipt.error) throw receipt.error;
 if (!receipt.data) return null;
 const ride = await withRequestTimeout(signal => supabase.from('taxi_requests').select('*').eq('id', command.p_request_id).abortSignal(signal).maybeSingle(), 5000);
 if (ride.error) throw ride.error;
 return verified({ receipt: receipt.data, ride: ride.data }, command, driverId);
}
export async function completeRidePayment(command: CheckoutCommand, driverId: string) {
 try {
  const { data, error } = await withRequestTimeout(signal => supabase.rpc('complete_ride_payment', command).abortSignal(signal), 15_000, undefined, 'ride.transition');
  if (error) throw error;
  return verified(data, command, driverId);
 } catch (cause) {
  if (!isAmbiguousWrite(cause)) throw cause;
  try { const ride = await findCheckout(command, driverId); if (ride) return ride; } catch { /* Retain the command; never auto-replay a financial write. */ }
  throw new Error('Потвърждението се забави. Провери плащането или повтори същия запис.');
 }
}
