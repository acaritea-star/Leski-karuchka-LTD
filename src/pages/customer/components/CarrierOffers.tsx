import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { CarrierOffer } from '@/lib/googleMaps';
import { carrierOfferKey } from '@/lib/marketplace';
import CarrierIdentity from '@/components/feature/CarrierIdentity';

export default function CarrierOffers({ offers, selected, onSelect, onBack, onRequest, onRefresh,
  creating, canRequest, calculating, expired, error, availabilityMessage, onRefreshAvailability }: {
  offers: CarrierOffer[]; selected: CarrierOffer | undefined; onSelect: (key: string) => void;
  onBack: () => void; onRequest: () => void; onRefresh: () => void;
  creating: boolean; canRequest: boolean; calculating: boolean; expired: boolean; error: string; availabilityMessage?: string; onRefreshAvailability?: () => void;
}) {
  const { t } = useTranslation();
  return <section className="booking-confirm booking-enter" aria-label="Оферти от фирмите">
    <div className="booking-scroll">
      <div className="carrier-offer-heading">
        <p>Цена за маршрута <span>Най-ниската първа</span></p>
        {!availabilityMessage && onRefreshAvailability && <button type="button" className="carrier-availability-refresh"
          aria-label="Обнови наличността" title="Обнови наличността" disabled={creating || calculating} onClick={onRefreshAvailability}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.1 3M4.8 14.9a8 8 0 0 0 13.1 3" />
          </svg>
        </button>}
      </div>
      {calculating ? <p className="booking-hint" role="status"><span className="booking-spinner" />{t('booking_calculating')}</p>
        : <div className="carrier-offer-list" role="radiogroup" aria-label="Избери фирма и цена">
          {offers.map((offer, i) => <label className="carrier-offer" key={carrierOfferKey(offer)}>
            <input type="radio" name="carrier-offer" checked={!!selected && carrierOfferKey(selected) === carrierOfferKey(offer)}
              disabled={creating || expired || !offer.quote_id} onChange={() => onSelect(carrierOfferKey(offer))}
              aria-label={`${offer.company_name}, ${offer.price.toFixed(2)} ${t('lv')}, ${offer.type_name}, ${offer.capacity} места`}
              onFocus={event => event.currentTarget.closest('label')?.scrollIntoView?.({ block: 'nearest' })} />
            <span className="carrier-offer-body">
              <span className="carrier-offer-check" aria-hidden="true" />
              <span className="carrier-offer-info"><strong className="carrier-offer-name">{offer.company_name}</strong>
                <span>{offer.type_name} · {offer.capacity} места</span>
                {i === 0 && <small>Най-ниска цена</small>}
              </span>
              <strong className="carrier-offer-price">{offer.price.toFixed(2)} {t('lv')}</strong>
            </span>
          </label>)}
        </div>}
      {availabilityMessage && <div className="booking-hint" role="status"><p>{availabilityMessage}</p><button type="button" className="underline" disabled={creating} onClick={onRefreshAvailability}>Обнови наличността</button></div>}
      {!calculating && !offers.length && <p className="booking-hint" role="status">Няма потвърдена оферта за тази категория. Обнови или избери друга категория.</p>}
      {(error || expired) && <div className="booking-error" role="alert"><span>{error || t('booking_quote_expired')}</span>
        <button type="button" disabled={creating || calculating} onClick={onRefresh}>Обнови офертите</button></div>}
      <div className="booking-meta"><button type="button" disabled={creating} onClick={onBack} className="underline">Маршрут и категория</button><span>{t('payment_in_cash')}</span></div>
      <p className="booking-fare-note">Заявката е само към избраната фирма. Ако няма кой да я приеме, можеш да избереш друга оферта.</p>
      <p className="text-xs text-foreground-700 leading-relaxed px-1 py-2">{t('booking_legal_notice')}{' '}
        <Link to="/terms" className="underline text-primary-700">{t('menu_terms')}</Link>{' · '}
        <Link to="/privacy" className="underline text-primary-700">{t('menu_privacy')}</Link>
      </p>
      {selected && <CarrierIdentity companyId={selected.company_id} />}
    </div>
    <div className="carrier-offer-footer">
    <p className="carrier-offer-summary" aria-live="polite">{selected ? <>Избрано: <strong>{selected.company_name}</strong></> : 'Избери фирма от списъка'}</p>
    <button type="button" className="booking-primary" disabled={!canRequest || creating} onClick={onRequest} aria-busy={creating}>
      {creating ? <><span className="booking-spinner" />{t('booking_sending')}</>
        : <><span>{t('booking_order')}</span><span>{selected && !expired && !calculating ? `${selected.price.toFixed(2)} ${t('lv')}` : '—'} <i className="ri-arrow-right-line" aria-hidden="true" /></span></>}
    </button>
    </div>
  </section>;
}
