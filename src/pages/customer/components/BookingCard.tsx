import { useTranslation } from 'react-i18next';
import type { FareBreakdown } from '@/lib/pricing';

export interface BookingLocation { address: string; lat: number; lng: number }
export interface VehicleOption { id: string; name: string; capacity: number; available: boolean }

interface BookingCardProps {
  pickup: BookingLocation;
  destination: BookingLocation;
  onFieldClick: (field: 'pickup' | 'dest') => void;
  onSwap: () => void;
  vehicleType: string;
  vehicleOptions: VehicleOption[];
  onVehicleTypeChange: (id: string) => void;
  fare: FareBreakdown | null;
  distance?: number;
  duration?: number;
  calculating: boolean;
  priceExpired: boolean;
  onRefreshPrice: () => void;
  canRequest: boolean;
  creating: boolean;
  onRequest: () => void;
  requestError: string;
}

function vehicleLabel(name: string, t: (key: string) => string) {
  if (/eco|econom|standard|иконом/i.test(name)) return t('vehicle_economy');
  if (/comfort|комфорт/i.test(name)) return t('vehicle_comfort');
  if (/van|ван|bus/i.test(name)) return t('vehicle_van');
  return name;
}

export default function BookingCard(props: BookingCardProps) {
  const { t } = useTranslation();
  return <div className="booking-confirm booking-enter">
    <div className="booking-scroll">
      <div className="booking-route">
        <div className="min-w-0 flex-1">
          {(['pickup', 'dest'] as const).map(field => <button key={field} type="button"
            className="booking-address" disabled={props.creating} onClick={() => props.onFieldClick(field)}
            aria-label={`${t(field === 'pickup' ? 'pickup_point' : 'destination_point')}: ${field === 'pickup' ? props.pickup.address : props.destination.address}`}>
            <span className={`route-dot ${field === 'dest' ? 'route-dot-end' : ''}`} aria-hidden="true" />
            <span className="truncate">{field === 'pickup' ? props.pickup.address : props.destination.address}</span>
            <i className="ri-pencil-line" aria-hidden="true" />
          </button>)}
        </div>
        <button type="button" className="booking-icon-button" onClick={props.onSwap} disabled={props.creating}
          aria-label={t('booking_swap')}><i className="ri-arrow-up-down-line" aria-hidden="true" /></button>
      </div>
      <fieldset disabled={props.creating} className="booking-vehicles">
        <legend className="sr-only">{t('vehicle_type')}</legend>
        {props.vehicleOptions.map(vehicle => <label key={vehicle.id} className={`booking-vehicle ${!vehicle.available ? 'unavailable' : ''}`}>
          <input type="radio" name="booking-vehicle" value={vehicle.id} checked={props.vehicleType === vehicle.id}
            disabled={!vehicle.available} onChange={() => props.onVehicleTypeChange(vehicle.id)} />
          <span><i className={vehicle.capacity > 4 ? 'ri-bus-line' : 'ri-taxi-line'} aria-hidden="true" />
            {vehicleLabel(vehicle.name, t)}<small>{t('booking_seats', { count: vehicle.capacity })}</small></span>
        </label>)}
      </fieldset>
      {props.calculating ? <p className="booking-hint" role="status"><span className="booking-spinner" />{t('booking_calculating')}</p>
        : <div className="booking-meta">
          <span>{props.distance != null && <>{props.distance.toFixed(1)} {t('km')} · {props.duration} {t('min')}</>}</span>
          <span><i className="ri-money-euro-circle-line" aria-hidden="true" /> {t('payment_in_cash')}</span>
        </div>}
      {(props.requestError || props.priceExpired) && <div className="booking-error" role="alert">
        <span>{props.requestError || t('booking_quote_expired')}</span>
        {!props.creating && <button type="button" onClick={props.canRequest ? props.onRequest : props.onRefreshPrice}>{t('booking_retry')}</button>}
      </div>}
    </div>
    <button type="button" className="booking-primary" disabled={!props.canRequest || props.creating}
      onClick={props.onRequest} aria-busy={props.creating}>
      {props.creating ? <><span className="booking-spinner" />{t('booking_sending')}</>
        : <><span>{t('booking_order')}</span><span>{props.fare && !props.priceExpired && !props.calculating
          ? `${props.fare.total.toFixed(2)} ${t('lv')}` : '—'} <i className="ri-arrow-right-line" aria-hidden="true" /></span></>}
    </button>
  </div>;
}
