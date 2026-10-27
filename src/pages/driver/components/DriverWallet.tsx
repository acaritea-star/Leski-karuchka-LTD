import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Modal from '@/components/feature/Modal';
import { useDriverDay } from '@/hooks/useDriverDay';
import type { Tables } from '@/lib/database.types';
import { onlinePaymentLabel } from '@/lib/ridePayment';
import './driver-wallet.css';

const euro = new Intl.NumberFormat('bg-BG', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 });
const walletMoney = (amount: number) => euro.format(amount);

function Receipt({ row, owner }: { row: Tables<'taxi_requests'>; owner: string }) {
  // Persist only the receipt identity, never its value or personal information.
  // Reopening the other driver panel must not celebrate the same payment twice.
  const key = `leski-wallet-receipt:${owner}:${row.driver_id}`;
  const [fresh] = useState(() => {
    try { return sessionStorage.getItem(key) !== row.id; } catch { return true; }
  });
  useEffect(() => { try { sessionStorage.setItem(key, row.id); } catch { /* Optional presentation storage. */ } }, [key, row.id]);
  const amount = row.final_price == null ? null : Number(row.final_price);
  return <div role="status" className="driver-wallet-receipt" data-new={fresh}>
    <span>{onlinePaymentLabel(row.payment_environment, row.payment_status)}</span>
    {amount != null && Number.isFinite(amount) && amount > 0 && <strong className="driver-wallet-credit">+{walletMoney(amount)}</strong>}
  </div>;
}

export default function DriverWallet({ owner, driverId, receipt }: { owner?: string; driverId?: string; receipt: Tables<'taxi_requests'> | null }) {
  const query = useDriverDay(driverId), navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const received = query.data?.received;
  const scoped = receipt?.payment_environment === 'live' && receipt?.driver_id === driverId && !!owner && receipt?.status === 'completed' && receipt.payment_status === 'paid' && receipt.payment_method === 'online';
  return <div className="driver-wallet" aria-label="Портфейл на шофьора">
    <button type="button" className="driver-wallet-summary" aria-label="Портфейл — получени по днешните курсове" onClick={() => setOpen(true)}>
      <span className="driver-wallet-heading"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 8V5a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v11H6a3 3 0 0 1-3-3V6"/><path d="M20 12h-5v4h5"/></svg><span><strong>Портфейл</strong><small>Получени днес</small></span></span>
      <span className="driver-wallet-value"><strong>{received ? walletMoney(received.total) : '— €'}</strong><span aria-hidden="true">›</span></span>
    </button>
    {query.isError && <button type="button" className="driver-wallet-retry" disabled={query.isFetching} onClick={() => void query.refetch()}>Сумата не е обновена · опитай отново</button>}
    {scoped && receipt && <Receipt key={`${owner}:${driverId}:${receipt.id}`} row={receipt} owner={owner!} />}
    {open && <Modal open={open} className="driver-wallet-dialog" label="Портфейл — днешни курсове" onClose={() => setOpen(false)}>
      <div className="driver-wallet-dialog-body">
        <div className="driver-wallet-dialog-header"><div><p>ПО КУРСОВЕТЕ ТИ</p><h2>Портфейл за днес</h2></div><button type="button" aria-label="Затвори портфейла" onClick={() => setOpen(false)}>×</button></div>
        {received ? <>
          <div className="driver-wallet-total"><span>Реални плащания</span><strong>{walletMoney(received.total)}</strong></div>
          <dl className="driver-wallet-breakdown">
            <div><dt>В брой</dt><dd>{walletMoney(received.cash)}</dd></div>
            <div><dt>С карта на терминал</dt><dd>{walletMoney(received.card)}</dd></div>
            <div><dt>Онлайн към фирмата</dt><dd>{walletMoney(received.online)}</dd></div>
          </dl>
        </> : <p role="status" className="driver-wallet-help">{query.isFetching ? 'Зареждаме потвърдените суми…' : 'Няма актуален сбор. Обнови портфейла.'}</p>}
        <p className="driver-wallet-help">Оборот по приключените днес курсове, след реалните корекции и възстановявания. Това не е сума за теглене или лично възнаграждение.</p>
        {query.isError && <p role="status" className="driver-wallet-help">Сумите не са обновени. Опитай отново.</p>}
        <div className="driver-wallet-actions"><button type="button" onClick={() => { setOpen(false); navigate('/driver/earnings'); }}>Отвори отчета</button><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? 'Обновяване…' : 'Обнови'}</button></div>
      </div>
    </Modal>}
  </div>;
}
