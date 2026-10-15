import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CarrierOffer } from '@/lib/googleMaps';
import { carrierOfferKey } from '@/lib/marketplace';
import CarrierIdentity from '@/components/feature/CarrierIdentity';

export default function CarrierOffers({ offers, selected, onSelect, onRequest, onRefresh,
  availableOffers, availabilityConfirmed, pickup, destination, onFieldClick, onSwap,
  vehicleType, vehicleOptions, onVehicleTypeChange,
  creating, canRequest, calculating, expired, error, availabilityMessage, onRefreshAvailability }: {
  offers: CarrierOffer[]; selected: CarrierOffer | undefined; onSelect: (key: string) => void;
  availableOffers: Set<string>; availabilityConfirmed: boolean;
  pickup: string; destination: string; onFieldClick: (field: 'pickup' | 'dest') => void; onSwap: () => void;
  vehicleType: string; vehicleOptions: { id: string; name: string; capacity: number; available: boolean }[]; onVehicleTypeChange: (id: string) => void;
  onRequest: () => void; onRefresh: () => void;
  creating: boolean; canRequest: boolean; calculating: boolean; expired: boolean; error: string; availabilityMessage?: string; onRefreshAvailability?: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const visibleOffers = offers.filter(offer => offer.company_name.toLocaleLowerCase('bg').includes(search.trim().toLocaleLowerCase('bg')));
  const cheapest = offers.find(offer => availableOffers.has(carrierOfferKey(offer)) && offer.quote_id && Date.parse(offer.quote_expires_at) > Date.now());
  return <section className="booking-confirm booking-enter" aria-label="Оферти от фирмите">
    <div className="booking-scroll">
      <div className="carrier-route" aria-label="Твоят маршрут">
        <button type="button" disabled={creating} onClick={() => onFieldClick('pickup')} aria-label={`Промени началния адрес: ${pickup}`} title={pickup}><small>От</small><span>{pickup}</span></button>
        <button type="button" className="carrier-route-swap" disabled={creating} onClick={onSwap} aria-label={t('booking_swap')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></svg>
        </button>
        <button type="button" disabled={creating} onClick={() => onFieldClick('dest')} aria-label={`Промени крайния адрес: ${destination}`} title={destination}><small>До</small><span>{destination}</span></button>
      </div>
      <label className="carrier-category"><span>Автомобил</span>
        <select aria-label="Категория автомобил" value={vehicleType} disabled={creating} onChange={event => onVehicleTypeChange(event.target.value)}>
          {vehicleOptions.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.name} · {option.capacity} места{!option.available ? ' · няма свободни' : ''}</option>)}
        </select>
      </label>
      <div className="carrier-offer-heading">
        <p>Фиксирана цена за маршрута <span>Най-ниската първа</span></p>
        {!availabilityMessage && onRefreshAvailability && <button type="button" className="carrier-availability-refresh"
          aria-label="Обнови наличността" title="Обнови наличността" disabled={creating || calculating} onClick={onRefreshAvailability}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.1 3M4.8 14.9a8 8 0 0 0 13.1 3" />
          </svg>
        </button>}
      </div>
      {(offers.length > 6 || search) && <div className="carrier-search">
        <input type="search" aria-label="Търси фирма" placeholder="Търси фирма…" value={search} disabled={creating} onChange={event => setSearch(event.target.value)} />
        {search && <button type="button" disabled={creating} onClick={() => setSearch('')}>Изчисти</button>}
      </div>}
      {calculating ? <p className="booking-hint" role="status"><span className="booking-spinner" />{t('booking_calculating')}</p>
        : <div className="carrier-offer-list" role="radiogroup" aria-label="Избери фирма и цена">
          {visibleOffers.map(offer => <label className="carrier-offer" key={carrierOfferKey(offer)}>
            <input type="radio" name="carrier-offer" checked={!!selected && carrierOfferKey(selected) === carrierOfferKey(offer)}
              disabled={creating || expired || !offer.quote_id || Date.parse(offer.quote_expires_at) <= Date.now() || !availableOffers.has(carrierOfferKey(offer))} onChange={() => onSelect(carrierOfferKey(offer))}
              aria-label={`${offer.company_name}, ${offer.price.toFixed(2)} ${t('lv')}, ${offer.type_name}, ${offer.capacity} места`}
              onFocus={event => event.currentTarget.closest('label')?.scrollIntoView?.({ block: 'nearest' })} />
            <span className="carrier-offer-body">
              <span className="carrier-offer-check" aria-hidden="true" />
              <span className="carrier-offer-info"><strong className="carrier-offer-name">{offer.company_name}</strong>
                <span>{offer.type_name} · {offer.capacity} места</span>
                {!availableOffers.has(carrierOfferKey(offer)) ? <small className="carrier-unavailable">{availabilityConfirmed ? 'Няма свободна кола' : 'Непотвърдена наличност'}</small>
                  : expired || !offer.quote_id || Date.parse(offer.quote_expires_at) <= Date.now() ? <small className="carrier-unavailable">Офертата е изтекла</small>
                  : cheapest === offer && <small>Най-ниска цена</small>}
              </span>
              <strong className="carrier-offer-price">{offer.price.toFixed(2)} {t('lv')}</strong>
            </span>
          </label>)}
        </div>}
      {!calculating && offers.length > 0 && !visibleOffers.length && <p className="booking-hint" role="status">Няма фирма с това име сред офертите. Изчисти търсенето, за да видиш всички.</p>}
      {availabilityMessage && <div className="booking-hint" role="status"><p>{availabilityMessage}</p><button type="button" className="underline" disabled={creating} onClick={onRefreshAvailability}>Обнови наличността</button></div>}
      {!calculating && !offers.length && <p className="booking-hint" role="status">Няма потвърдена оферта за тази категория. Обнови или избери друга категория.</p>}
      {(error || expired) && <div className="booking-error" role="alert"><span>{error || t('booking_quote_expired')}</span>
        <button type="button" disabled={creating || calculating} onClick={onRefresh}>Обнови офертите</button></div>}
      <div className="booking-meta"><span>{t('payment_in_cash')}</span><span>Цената е за избрания маршрут</span></div>
      <p className="booking-fare-note">Заявката е само към избраната фирма. Ако няма кой да я приеме, можеш да избереш друга оферта.</p>
      <p className="text-xs text-foreground-700 leading-relaxed px-1 py-2">{t('booking_legal_notice')}{' '}
        <Link to="/terms" className="underline text-primary-700">{t('menu_terms')}</Link>{' · '}
        <Link to="/privacy" className="underline text-primary-700">{t('menu_privacy')}</Link>
      </p>
      {selected && <CarrierIdentity companyId={selected.company_id} />}
    </div>
    <div className="carrier-offer-footer">
    <p className="carrier-offer-summary" aria-live="polite">{selected ? <>Избрано: <strong>{selected.company_name}</strong></> : 'Избери фирма от списъка'}</p>
    {selected && availabilityConfirmed && !availableOffers.has(carrierOfferKey(selected)) && <p className="carrier-selection-unavailable" role="status">Тази фирма вече няма свободна кола. Избери друга оферта или обнови наличността.</p>}
    <button type="button" className="booking-primary" disabled={!canRequest || creating} onClick={onRequest} aria-busy={creating}>
      {creating ? <><span className="booking-spinner" />{t('booking_sending')}</>
        : <><span>{t('booking_order')}</span><span>{selected && !expired && !calculating ? `${selected.price.toFixed(2)} ${t('lv')}` : '—'} <i className="ri-arrow-right-line" aria-hidden="true" /></span></>}
    </button>
    </div>
  </section>;
}
