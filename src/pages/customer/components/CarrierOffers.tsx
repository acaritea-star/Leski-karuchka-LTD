import { useRef } from 'react';
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
  const rail = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => rail.current?.scrollBy({ left: direction * rail.current.clientWidth * .8,
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  return <section className="booking-confirm booking-enter" aria-label="Оферти от фирмите">
    <div className="booking-scroll">
      <div className="carrier-offer-heading">
        <p className="booking-hint">Най-ниската цена е първа. Избери фирма — сумата се запазва за тази поръчка.</p>
        {offers.length > 1 && <div className="carrier-offer-controls">
          <button type="button" className="booking-icon-button" aria-label="Предишни оферти" onClick={() => scroll(-1)}><i className="ri-arrow-left-s-line" aria-hidden="true" /></button>
          <button type="button" className="booking-icon-button" aria-label="Следващи оферти" onClick={() => scroll(1)}><i className="ri-arrow-right-s-line" aria-hidden="true" /></button>
        </div>}
      </div>
      {calculating ? <p className="booking-hint" role="status"><span className="booking-spinner" />{t('booking_calculating')}</p>
        : <div className="carrier-offer-rail" ref={rail} role="radiogroup" aria-label="Избери фирма и цена">
          {offers.map((offer, i) => <label className="carrier-offer" key={carrierOfferKey(offer)}>
            <input type="radio" name="carrier-offer" checked={!!selected && carrierOfferKey(selected) === carrierOfferKey(offer)}
              disabled={creating || expired || !offer.quote_id} onChange={() => onSelect(carrierOfferKey(offer))}
              onFocus={event => event.currentTarget.closest('label')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })} />
            <span className="carrier-offer-body">
              <small>{i === 0 ? 'Най-ниска цена' : 'Фирмена оферта'}</small>
              <strong className="carrier-offer-name">{offer.company_name}</strong>
              <span>{offer.type_name} · {offer.capacity} места</span>
              <strong className="carrier-offer-price">{offer.price.toFixed(2)} {t('lv')}</strong>
              <span className="carrier-offer-choice"><i className={selected && carrierOfferKey(selected) === carrierOfferKey(offer) ? 'ri-checkbox-circle-fill' : 'ri-checkbox-blank-circle-line'} aria-hidden="true" />
                {selected && carrierOfferKey(selected) === carrierOfferKey(offer) ? 'Избрана фирма' : 'Избери'}</span>
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
    <button type="button" className="booking-primary" disabled={!canRequest || creating} onClick={onRequest} aria-busy={creating}>
      {creating ? <><span className="booking-spinner" />{t('booking_sending')}</>
        : <><span>{t('booking_order')}</span><span>{selected && !expired && !calculating ? `${selected.price.toFixed(2)} ${t('lv')}` : '—'} <i className="ri-arrow-right-line" aria-hidden="true" /></span></>}
    </button>
    {selected && <p className="carrier-offer-summary">С {selected.company_name}</p>}
  </section>;
}
