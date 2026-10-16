import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/feature/Modal';
import { money, parseMoney } from '@/lib/accounting';
import { clearCheckout, completeRidePayment, findCheckout, prepareCheckout, readCheckout, type CheckoutCommand, type PaymentChoice } from '@/lib/rideCheckout';
import { isAmbiguousWrite } from '@/lib/rideOperations';
import type { Tables } from '@/lib/database.types';
const button = 'min-h-12 rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40';
const input = 'mt-1 w-full min-h-11 rounded-xl border border-background-200 px-3 py-2 text-sm';
export default function RideCheckout({ owner, driverId, request, onClose, onFinished }: {
 owner: string; driverId: string; request: Tables<'taxi_requests'> | null; onClose: () => void; onFinished: (ride: Tables<'taxi_requests'>) => void;
}) {
 const [pending, setPending] = useState<CheckoutCommand | null>(null);
 const [error, setError] = useState('');
 const [storageBlocked, setStorageBlocked] = useState(false);
 const [hidden, setHidden] = useState(false);
 const [problem, setProblem] = useState(false);
 const [choice, setChoice] = useState<PaymentChoice>('unpaid');
 const [partial, setPartial] = useState('');
 const [note, setNote] = useState('');
 const [busy, setBusy] = useState(false);
 const inFlight = useRef(false), mounted = useRef(true);
 useEffect(() => {
  mounted.current = true;
  try {
   const intent = readCheckout(owner);
   if (intent && intent.driverId !== driverId) { setStorageBlocked(true); setError('Има непотвърдено плащане от друг шофьорски профил. Свържи се с фирмата за проверка.'); }
   else setPending(intent?.command ?? null);
  } catch (e) { setStorageBlocked(true); setError(e instanceof Error ? e.message : 'Разреши съхранението за сайта.'); }
  return () => { mounted.current = false; };
 }, [owner, driverId]);
 const requestId = request?.id;
 useEffect(() => { if (requestId) { setHidden(false); setProblem(false); setPartial(''); setNote(''); } }, [requestId]);
 const finish = (command: CheckoutCommand, ride: Tables<'taxi_requests'>) => {
  if (!mounted.current) return;
  clearCheckout(command); setPending(null); setError(''); onFinished(ride); onClose();
 };
 const run = async (nextChoice?: PaymentChoice, checkOnly = false) => {
  if (inFlight.current || storageBlocked) return;
  inFlight.current = true; setBusy(true); setError('');
  let command = pending;
  try {
   if (!command) {
    if (!request || !nextChoice) throw new Error('Обнови курса и опитай отново.');
    const amount = nextChoice.startsWith('partial_') ? parseMoney(partial) : null;
    if (amount !== null && (request.estimated_price == null || amount >= Number(request.estimated_price))) throw new Error('Частичното плащане трябва да е под цялата цена.');
    if (['unpaid','partial_cash','partial_card'].includes(nextChoice) && !note.trim()) throw new Error('Опиши проблема с плащането.');
    command = prepareCheckout(driverId, { p_request_id: request.id, p_actor: owner, p_choice: nextChoice, p_partial_amount: amount, p_note: nextChoice === 'cash' || nextChoice === 'card' ? '' : note.trim() });
    setPending(command);
   }
   const ride = checkOnly ? await findCheckout(command, driverId) : await completeRidePayment(command, driverId);
   if (!ride) throw new Error('Все още няма потвърждение. Повтори същия запис, когато имаш връзка.');
   finish(command, ride);
  } catch (cause) {
   if (!mounted.current) return;
   if (command && !checkOnly && !isAmbiguousWrite(cause)) { clearCheckout(command); setPending(null); }
   const message = cause && typeof cause === 'object' && 'message' in cause ? String(cause.message) : '';
   setError(message.includes('already completed') ? 'Курсът вече е приключен или е променен от друг екран. Обнови заявките и отчета.' : message || 'Плащането не е потвърдено.');
  } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
 };
 const close = () => { if (!busy) { setHidden(true); onClose(); } };
 const visible = !!request || !!pending && !hidden;
 return <>
  {(pending && hidden || storageBlocked && !visible) && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
   <p>{storageBlocked ? error : 'Плащане по предишен курс изчаква потвърждение.'}</p>
   {pending && <button className={`${button} underline`} onClick={() => setHidden(false)}>Провери плащането</button>}
  </div>}
  {visible && <Modal label="Плащане и приключване на курс" onClose={close} busy={busy} className="max-w-md">
   <div className="p-5 space-y-4">
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-lg">Плащане по курса</h2><button type="button" aria-label="Затвори плащането" disabled={busy} className="min-h-11 min-w-11" onClick={close}>×</button></div>
    {pending ? <div className="rounded-xl bg-amber-50 p-4 space-y-2">
     <p className="font-semibold">Изчаква потвърждение</p><p className="text-sm">Курс {pending.p_request_id.slice(0,8)} · {pending.p_choice === 'unpaid' ? 'Неплатен' : pending.p_choice.includes('cash') ? 'В брой' : 'С карта'}{pending.p_partial_amount != null && ` · ${money(pending.p_partial_amount)}`}</p>
     <p className="text-xs">Проверката не добавя второ плащане. Повторението използва същия запис.</p>
     <button className={`${button} w-full bg-primary-500 text-white`} disabled={busy} onClick={() => void run(undefined, true)}>Провери плащането</button>
     <button className={`${button} w-full border border-background-200`} disabled={busy} onClick={() => void run()}>Повтори същия запис</button>
    </div> : request && <>
     <div className="rounded-2xl bg-primary-50 p-5 text-center"><p className="text-xs text-foreground-600">Цена от заявката</p><p className="mt-1 text-4xl font-bold tabular-nums">{money(request.estimated_price == null ? null : Number(request.estimated_price))}</p><p className="mt-2 text-xs">Курс {request.id.slice(0,8)}</p></div>
     {!problem ? <>
      <p className="text-sm text-foreground-600">Как получи парите? Потвърждението приключва курса и добавя плащането в отчета.</p>
      <button className={`${button} w-full bg-primary-500 text-white`} disabled={busy || storageBlocked || request.estimated_price == null} onClick={() => void run('cash')}>Получих в брой · приключи</button>
      <button className={`${button} w-full border border-primary-300 text-primary-800`} disabled={busy || storageBlocked || request.estimated_price == null} onClick={() => void run('card')}>Получих с карта · приключи</button>
      <p className="text-xs text-foreground-500">При карта потвърди след успешно плащане на терминала. Бутонът не тегли пари от картата.</p>
      <button className={`${button} w-full underline text-foreground-600`} disabled={busy || storageBlocked} onClick={() => setProblem(true)}>Проблем с плащането</button>
     </> : <form className="space-y-3" onSubmit={e => { e.preventDefault(); void run(choice); }}>
      <p className="text-sm">Запиши само реално полученото. Остатъкът ще се вижда в отчета.</p>
      <label className="block text-sm">Получено плащане<select className={input} value={choice} onChange={e => setChoice(e.target.value as PaymentChoice)}><option value="unpaid">Няма получени пари</option><option value="partial_cash">Част от сумата — в брой</option><option value="partial_card">Част от сумата — с карта</option></select></label>
      {choice !== 'unpaid' && <label className="block text-sm">Получена сума в евро<input className={input} inputMode="decimal" value={partial} onChange={e => setPartial(e.target.value)} required /></label>}
      <label className="block text-sm">Причина<textarea className={input} value={note} onChange={e => setNote(e.target.value)} maxLength={500} required placeholder="Например: картата е отказана" /></label>
      <button disabled={busy || storageBlocked} className={`${button} w-full bg-foreground-900 text-white`}>Запиши проблема и приключи</button>
      <button type="button" disabled={busy} className={`${button} w-full underline`} onClick={() => setProblem(false)}>Назад към плащането</button>
     </form>}
    </>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {busy && <p role="status" className="text-sm">Проверка и запазване…</p>}
   </div>
  </Modal>}
 </>;
}
