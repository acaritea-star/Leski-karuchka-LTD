import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { cancelTaxiRequest } from '@/lib/rideOperations';
import { queryKeys } from '@/lib/queryKeys';
import type { Tables } from '@/lib/database.types';
import Modal from '@/components/feature/Modal';

type Ride = Tables<'taxi_requests'>;
export default function CancelRideButton({ request, onCancelled, className = '' }: {
  request: Pick<Ride, 'id' | 'status'>; onCancelled?: (ride: Ride) => void; className?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), generation = useRef(0);
  const allowed = ['pending', 'accepted', 'arrived'].includes(request.status);
  useEffect(() => {
    const revision = ++generation.current;
    locked.current = false; setOpen(false); setBusy(false); setError('');
    return () => { generation.current = revision + 1; };
  }, [request.id, user?.id]);
  useEffect(() => { if (!allowed) setOpen(false); }, [allowed]);

  const cancel = async () => {
    if (locked.current || !allowed || !user) return;
    locked.current = true; setBusy(true); setError('');
    const revision = generation.current, customerId = user.id;
    try {
      const row = await cancelTaxiRequest(request.id, request.status);
      if (revision !== generation.current) return;
      // Use the server receipt immediately; no waiting for a second list request.
      client.setQueryData<Ride[]>(queryKeys.customerOrders(customerId), previous => previous?.map(ride => ride.id === row.id ? row : ride));
      setOpen(false); onCancelled?.(row);
    } catch {
      if (revision !== generation.current) return;
      setError('Отказът не е потвърден. Провери връзката и опитай отново. Ако курсът вече е започнал, свържи се с шофьора.');
      // A driver may have progressed the ride while the confirmation was open.
      void client.invalidateQueries({ queryKey: queryKeys.customerOrders(customerId) });
    } finally {
      if (revision === generation.current) { locked.current = false; setBusy(false); }
    }
  };
  if (!allowed) return null;
  return <>
    <button type="button" className={`ride-cancel-button ${className}`} aria-haspopup="dialog" onClick={() => { setError(''); setOpen(true); }}>{t('cancel_request')}</button>
    {open && <Modal label={t('confirm_cancel')} busy={busy} onClose={() => setOpen(false)} className="ride-cancel-dialog">
      <h2>{t('confirm_cancel')}</h2>
      <p>Шофьорът ще бъде уведомен, след като отказът е потвърден.</p>
      {error && <p role="alert" className="ride-cancel-error">{error}</p>}
      <div className="ride-cancel-choices">
        <button type="button" className="ride-cancel-keep" onClick={() => setOpen(false)}>{t('keep_request')}</button>
        <button type="button" className="ride-cancel-confirm" onClick={() => void cancel()}>{busy ? t('booking_cancel_sending') : t('yes_cancel')}</button>
      </div>
    </Modal>}
  </>;
}
