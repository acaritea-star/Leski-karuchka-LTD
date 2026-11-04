import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/feature/Modal';
import { ACTIVE_RIDE_STATUSES, adminCancelTaxiRequest, type AdminCancelReason } from '@/lib/rideOperations';
import type { Tables } from '@/lib/database.types';

type Ride = Tables<'taxi_requests'>;
const REASONS: { value: AdminCancelReason; label: string }[] = [
  { value: 'admin_driver_unfinished', label: 'Шофьорът не е приключил курса' },
  { value: 'admin_customer_request', label: 'Клиентът помоли за отмяна' },
  { value: 'admin_other', label: 'Друга причина' },
];

function failureMessage(cause: unknown) {
  const text = cause instanceof Error ? cause.message : '';
  if (/online payment/i.test(text)) return 'По този курс има започнато онлайн плащане. Първо го приключи или откажи, после отмени курса.';
  if (/already closed|PGRST116/i.test(text)) return 'Курсът вече е приключен или отменен. Обнови списъка.';
  return 'Отмяната не е потвърдена. Провери връзката и опитай отново.';
}

export default function AdminCancelRideButton({ request, onCancelled }: {
  request: Pick<Ride, 'id' | 'status'>; onCancelled?: (ride: Ride) => void;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reason, setReason] = useState<AdminCancelReason | ''>('');
  const locked = useRef(false), generation = useRef(0);
  const allowed = (ACTIVE_RIDE_STATUSES as readonly string[]).includes(request.status);
  useEffect(() => {
    const revision = ++generation.current;
    locked.current = false; setOpen(false); setBusy(false); setError(''); setReason('');
    return () => { generation.current = revision + 1; };
  }, [request.id]);
  useEffect(() => { if (!allowed) setOpen(false); }, [allowed]);

  const cancel = async () => {
    if (locked.current || !allowed) return;
    if (!reason) { setError('Избери причина за отмяната.'); return; }
    locked.current = true; setBusy(true); setError('');
    const revision = generation.current;
    try {
      const row = await adminCancelTaxiRequest(request.id, request.status, reason);
      if (revision !== generation.current) return;
      setOpen(false); onCancelled?.(row);
    } catch (cause) {
      if (revision !== generation.current) return;
      setError(failureMessage(cause));
    } finally {
      if (revision === generation.current) { locked.current = false; setBusy(false); }
    }
  };

  if (!allowed) return null;
  return <>
    <button type="button" aria-haspopup="dialog" onClick={() => { setError(''); setReason(''); setOpen(true); }}
      className="ml-auto min-h-11 px-4 rounded-xl border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50 whitespace-nowrap">
      Отмени курса
    </button>
    {open && <Modal label="Отмяна на курса" busy={busy} onClose={() => setOpen(false)} className="max-w-md">
      <div className="p-5 space-y-4">
        <h2 className="text-lg font-semibold text-foreground-950">Да отменя ли курса?</h2>
        <p className="text-sm text-foreground-600">
          Курсът ще бъде затворен без начислен оборот. Шофьорът и клиентът се освобождават за нови поръчки.
          {request.status === 'in_progress' && ' Използвай това само ако курсът реално е приключил или не се е състоял.'}
        </p>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground-800 mb-1">Причина</legend>
          {REASONS.map(option => <label key={option.value} className="flex items-center gap-3 min-h-11 px-3 rounded-xl border border-background-200 text-sm cursor-pointer">
            <input type="radio" name={`admin-cancel-${request.id}`} value={option.value} checked={reason === option.value}
              onChange={() => { setReason(option.value); setError(''); }} />
            {option.label}
          </label>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button type="button" className="min-h-11 px-4 rounded-xl border border-background-200 text-sm font-semibold" onClick={() => setOpen(false)}>Не, остави го</button>
          <button type="button" className="min-h-11 px-4 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50" onClick={() => void cancel()}>
            {busy ? 'Отменям…' : 'Да, отмени курса'}
          </button>
        </div>
      </div>
    </Modal>}
  </>;
}
