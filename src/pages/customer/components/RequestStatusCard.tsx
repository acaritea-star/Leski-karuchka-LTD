import CarrierIdentity from '@/components/feature/CarrierIdentity';
import { useTranslation } from 'react-i18next';
import { carrierChoiceName, displayPriceRange, type PriceRange } from '@/lib/marketplace';

export interface RequestData {
  id: string; company_id?: string; status: string; pickup_address: string; destination_address: string;
  estimated_price: number | null; cancelled_by?: string | null;
  payment_status?:string;payment_method?:string;
  fare_breakdown?: import('@/lib/database.types').Json | null;
}
interface RequestStatusCardProps {
  priceRange?: PriceRange;
  request: RequestData; price: number | null; confirmCancel: boolean; cancelling?: boolean;
  onShowCancel: () => void; onKeepRequest: () => void; onCancel: () => void;
  onReset: () => void; onShare: () => void; onNewOrder?: () => void; requestError: string;
}

export default function RequestStatusCard(props: RequestStatusCardProps) {
  const { t } = useTranslation();
  const { request } = props;
  const pending = request.status === 'pending';
  const completed = request.status === 'completed';
  const cancelled = request.status === 'cancelled';
  const noDriver = cancelled && request.cancelled_by === 'system';
  const carrierName = carrierChoiceName(request.fare_breakdown);
  const title = pending ? carrierName ? `Търсим шофьор от ${carrierName}` : t('booking_searching') : noDriver ? t('no_driver_available') : t(`status_${request.status}`);
  const hint = pending ? carrierName ? 'Заявката е само към свободните шофьори на избраната фирма.' : t('booking_searching_hint')
    : noDriver ? carrierName ? `${carrierName} не прие заявката навреме. Можеш да избереш друга оферта за същия маршрут.` : t('no_driver_available_desc')
    : completed ? t('trip_completed') : cancelled ? t('cancelled') : t('booking_driver_connecting');

  return <section className="booking-status booking-enter" aria-label={title}>
    <div className="booking-status-heading" role="status" aria-live="polite">
      <div className={`booking-status-icon ${pending ? 'booking-pulse' : ''}`} aria-hidden="true">
        <i className={pending ? 'ri-taxi-line' : completed ? 'ri-check-line' : cancelled ? 'ri-close-line' : 'ri-car-line'} />
      </div><div><h2>{title}</h2><p>{hint}</p></div>
    </div>
    <div className="booking-scroll">
      {props.confirmCancel && pending ? <div className="booking-cancel-confirm">
        <p>{t('confirm_cancel')}</p><div>
          <button type="button" className="booking-secondary" disabled={props.cancelling} onClick={props.onKeepRequest}>{t('keep_request')}</button>
          <button type="button" className="booking-secondary booking-danger" disabled={props.cancelling} onClick={props.onCancel}>
            {props.cancelling ? t('booking_cancel_sending') : t('yes_cancel')}</button>
        </div>
      </div> : <div className="booking-status-route">
        <p><span className="route-dot" aria-hidden="true" /><span title={request.pickup_address}>{request.pickup_address}</span></p>
        <p><span className="route-dot route-dot-end" aria-hidden="true" /><span title={request.destination_address}>{request.destination_address}</span></p>
      </div>}
      {props.price != null && <div className="booking-meta"><span>{request.payment_method==='online'?(request.payment_status==='paid'?'Платено онлайн':request.payment_status==='refunded'?'Възстановено онлайн':'Онлайн плащане'):t('payment_in_cash')}</span><strong>{pending && props.priceRange ? displayPriceRange(props.priceRange) : props.price.toFixed(2)} {t('lv')}</strong></div>}
      <CarrierIdentity companyId={request.company_id} />
      {props.requestError && <p className="booking-error" role="alert">{props.requestError}</p>}
    </div>
    <div className="booking-status-actions">
      {pending ? <>
        {typeof navigator.share === 'function' && <button type="button" className="booking-secondary" onClick={props.onShare}>{t('share_trip')}</button>}
        {!props.confirmCancel && <button type="button" className="booking-secondary" onClick={props.onShowCancel}>{t('cancel_request')}</button>}
      </> : (completed || cancelled) && <>
        <button type="button" className="booking-secondary" onClick={props.onReset}>{t('nav_orders')}</button>
        {props.onNewOrder && <button type="button" className="booking-primary" onClick={props.onNewOrder}>{noDriver ? 'Виж други оферти' : t('order_new_taxi')}</button>}
      </>}
    </div>
  </section>;
}
