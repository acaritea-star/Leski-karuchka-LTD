import { useTranslation } from 'react-i18next';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CarrierOffer } from '@/lib/googleMaps';
import { carrierOfferKey } from '@/lib/marketplace';
import CarrierIdentity from '@/components/feature/CarrierIdentity';
import type { CarrierPanelView } from './CustomerLayout';

export function CarrierRoute({ pickup, destination, onFieldClick, onSwap, creating, refreshing, onRefresh }: {
  pickup: string; destination: string; onFieldClick: (field: 'pickup' | 'dest') => void; onSwap: () => void;
  creating: boolean; refreshing: boolean; onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  return <div className="carrier-route" aria-label="Твоят маршрут">
    <button type="button" disabled={creating} onClick={() => onFieldClick('pickup')} aria-label={`Промени началния адрес: ${pickup}`} title={pickup}><small>От</small><span>{pickup}</span></button>
    <button type="button" className="carrier-route-swap" disabled={creating} onClick={onSwap} aria-label={t('booking_swap')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4" /></svg>
    </button>
    <button type="button" disabled={creating} onClick={() => onFieldClick('dest')} aria-label={`Промени крайния адрес: ${destination}`} title={destination}><small>До</small><span>{destination}</span></button>
    {onRefresh && <button type="button" className="carrier-availability-refresh" aria-label="Обнови наличността" title="Обнови наличността" disabled={creating || refreshing} onClick={onRefresh}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.1 3M4.8 14.9a8 8 0 0 0 13.1 3" /></svg>
    </button>}
  </div>;
}

export default function CarrierOffers({ offers, selected, onSelect, onRequest, onRefresh,
  availableOffers, availabilityConfirmed, vehicleType, vehicleOptions, onVehicleTypeChange,
  view, onViewChange, creating, canRequest, calculating, expired, error, availabilityMessage, onRefreshAvailability }: {
  offers: CarrierOffer[]; selected: CarrierOffer | undefined; onSelect: (key: string) => void;
  availableOffers: Set<string>; availabilityConfirmed: boolean;
  vehicleType: string; vehicleOptions: { id: string; name: string; capacity: number; available: boolean }[]; onVehicleTypeChange: (id: string) => void;
  view: CarrierPanelView; onViewChange: (view: CarrierPanelView) => void;
  onRequest: () => void; onRefresh: () => void;
  creating: boolean; canRequest: boolean; calculating: boolean; expired: boolean; error: string; availabilityMessage?: string; onRefreshAvailability?: () => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const listId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const focusToggle = useRef(false);
  const returnView = useRef<CarrierPanelView>('preview');
  useLayoutEffect(() => {
    if (focusToggle.current) { toggle.current?.focus({ preventScroll: true }); focusToggle.current = false; }
  }, [view]);
  const quotedAt = Date.now();
  const eligible = (offer: CarrierOffer) => availableOffers.has(carrierOfferKey(offer)) && !!offer.quote_id && Date.parse(offer.quote_expires_at) > quotedAt;
  const cheapest = offers.find(eligible);
  const preview = offers.filter(eligible).slice(0, 2);
  if (!preview.length) preview.push(...offers.slice(0, 2));
  // An unavailable selection stays visible; presentation never substitutes a firm.
  if (selected && !preview.includes(selected)) preview.splice(1, 1, selected);
  const shown = view === 'preview' ? offers.filter(offer => preview.includes(offer)) : offers;
  const visibleOffers = shown.filter(offer => offer.company_name.toLocaleLowerCase('bg').includes(search.trim().toLocaleLowerCase('bg')));
  const changeView = (next: CarrierPanelView) => { focusToggle.current = true; onViewChange(next); };
  const choose = (offer: CarrierOffer) => { setSearch(''); onSelect(carrierOfferKey(offer)); changeView('selected'); };
  const selectedUnavailable = !!selected && availabilityConfirmed && !availableOffers.has(carrierOfferKey(selected));
  return <section className="booking-confirm carrier-panel" aria-label="Оферти от фирмите" data-view={view}>
    <div className="carrier-panel-heading">
      <h1 aria-label={t('booking_offers')}>{view === 'selected' && selected ? selected.company_name : view === 'details' ? 'Детайли' : 'Фирми'}</h1>
      {view !== 'selected' && view !== 'details' && <label className="carrier-category"><span className="sr-only">Автомобил</span>
        <select aria-label="Категория автомобил" value={vehicleType} disabled={creating} onChange={event => { setSearch(''); onVehicleTypeChange(event.target.value); }}>
          {vehicleOptions.map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.name}{!option.available ? ' · няма свободни' : ''}</option>)}
        </select>
      </label>}
      <button ref={toggle} type="button" className="carrier-panel-toggle" disabled={creating} aria-controls={listId}
        aria-expanded={view === 'all' || view === 'details'} onClick={() => {
          setSearch('');
          changeView(view === 'details' ? returnView.current : view === 'all' ? selected ? 'selected' : 'preview' : 'all');
        }}>{view === 'details' ? 'Назад' : view === 'selected' ? 'Смени' : view === 'all' ? 'Свий' : <>Всички <span>{offers.length}</span></>}</button>
      {view !== 'details' && <button type="button" className="carrier-details-button" disabled={creating} aria-label="Цена, условия и превозвач" title="Детайли за офертата" onClick={() => { returnView.current = view; changeView('details'); }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.01" /></svg>
      </button>}
    </div>
    <div className="booking-scroll" id={listId}>
      {view === 'details' ? <div className="carrier-details">
        <p className="booking-fare-note">Фиксирана цена за избрания маршрут · {t('payment_in_cash')}</p>
        <p className="booking-fare-note">Заявката е само към избраната фирма. Ако няма кой да я приеме, можеш да избереш друга оферта.</p>
        <p>{t('booking_legal_notice')}{' '}<Link to="/terms">{t('menu_terms')}</Link>{' · '}<Link to="/privacy">{t('menu_privacy')}</Link></p>
        {selected && <CarrierIdentity companyId={selected.company_id} />}
      </div> : view !== 'selected' && <>
        {view === 'all' && (offers.length > 6 || search) && <div className="carrier-search">
          <input type="search" aria-label="Търси фирма" placeholder="Търси фирма…" value={search} disabled={creating} onChange={event => setSearch(event.target.value)} />
          {search && <button type="button" disabled={creating} onClick={() => setSearch('')}>Изчисти</button>}
        </div>}
        {calculating ? <p className="booking-hint" role="status"><span className="booking-spinner" />{t('booking_calculating')}</p>
          : <div className="carrier-offer-list" role="radiogroup" aria-label="Избери фирма и цена">
            {visibleOffers.map(offer => <label className="carrier-offer" key={carrierOfferKey(offer)}>
              <input type="radio" name="carrier-offer" checked={!!selected && carrierOfferKey(selected) === carrierOfferKey(offer)}
                disabled={creating || expired || !offer.quote_id || Date.parse(offer.quote_expires_at) <= quotedAt || !availableOffers.has(carrierOfferKey(offer))}
                onChange={() => choose(offer)} onClick={() => { if (selected && carrierOfferKey(selected) === carrierOfferKey(offer)) choose(offer); }}
                aria-label={`${offer.company_name}, ${offer.price.toFixed(2)} ${t('lv')}, ${offer.type_name}, ${offer.capacity} места`}
                onFocus={event => event.currentTarget.closest('label')?.scrollIntoView?.({ block: 'nearest' })} />
              <span className="carrier-offer-body">
                <span className="carrier-offer-check" aria-hidden="true" />
                <span className="carrier-offer-info"><strong className="carrier-offer-name">{offer.company_name}</strong>
                  {!availableOffers.has(carrierOfferKey(offer)) ? <small className="carrier-unavailable">{availabilityConfirmed ? 'Няма свободна кола' : 'Непотвърдена наличност'}</small>
                    : expired || !offer.quote_id || Date.parse(offer.quote_expires_at) <= quotedAt ? <small className="carrier-unavailable">Офертата е изтекла</small>
                    : cheapest === offer && <small>Най-ниска цена</small>}
                </span>
                <strong className="carrier-offer-price">{offer.price.toFixed(2)} {t('lv')}</strong>
              </span>
            </label>)}
          </div>}
        {!calculating && offers.length > 0 && !visibleOffers.length && <p className="booking-hint" role="status">Няма фирма с това име сред офертите. Изчисти търсенето, за да видиш всички.</p>}
        {!calculating && !offers.length && <p className="booking-hint" role="status">Няма потвърдена оферта за тази категория. Обнови или избери друга категория.</p>}
      </>}
      {availabilityMessage && <div className="booking-hint" role="status"><p>{availabilityMessage}</p><button type="button" className="underline" disabled={creating} onClick={onRefreshAvailability}>Обнови наличността</button></div>}
      {selectedUnavailable && <p className="carrier-selection-unavailable" role="status">Тази фирма вече няма свободна кола. Избери друга оферта или обнови наличността.</p>}
      {(error || expired) && <div className="booking-error" role="alert"><span>{error || t('booking_quote_expired')}</span>
        <button type="button" disabled={creating || calculating} onClick={onRefresh}>Обнови офертите</button></div>}
    </div>
    <div className="carrier-offer-footer">
      <p className="carrier-offer-summary sr-only" aria-live="polite">{selected ? <>Избрано: <strong>{selected.company_name}</strong></> : 'Избери фирма от списъка'}</p>
      <button type="button" className="booking-primary" disabled={!canRequest || creating} onClick={onRequest} aria-busy={creating}>
        {creating ? <><span className="booking-spinner" />{t('booking_sending')}</>
          : <><span className="carrier-order-label"><span>{t('booking_order')}</span>{selected && <small>{selected.company_name} · {t('payment_in_cash')}</small>}</span><span>{selected && !expired && !calculating ? `${selected.price.toFixed(2)} ${t('lv')}` : '—'} <i className="ri-arrow-right-line" aria-hidden="true" /></span></>}
      </button>
    </div>
  </section>;
}
