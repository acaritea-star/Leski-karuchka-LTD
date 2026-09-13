import { useTranslation } from 'react-i18next';
import type { FareBreakdown } from '@/lib/pricing';

export interface BookingLocation {
  address: string;
  lat: number;
  lng: number;
}

interface BookingCardProps {
  pickup: BookingLocation | null;
  destination: BookingLocation | null;
  selectingField: 'pickup' | 'dest' | null;
  onFieldClick: (field: 'pickup' | 'dest') => void;
  onClearPickup: () => void;
  onClearDestination: () => void;
  onSwap: () => void;
  vehicleType: string;
  vehicleOptions: {id: string; label: string; icon: string}[];
  onVehicleTypeChange: (id: string) => void;
  paymentMethod: string;
  onPaymentMethodChange: (method: string) => void;
  fare: FareBreakdown | null;
  priceIsEstimate?: boolean;
  showFareDetails: boolean;
  onToggleFareDetails: () => void;
  canRequest: boolean;
  creating: boolean;
  onRequest: () => void;
  requestError: string;
}

const PAYMENT_OPTIONS = [{ id: 'cash', icon: 'ri-cash-line' }] as const;

export default function BookingCard(props: BookingCardProps) {
  const { t } = useTranslation();
  const hasRoute = !!props.pickup && !!props.destination;
  const selecting = props.selectingField;

  return (
    <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-background-100 overflow-hidden">
      {/* Address rows */}
      <div className="relative px-3 pt-1">
        {hasRoute && <div className="absolute left-[25px] top-6 bottom-5 w-px bg-background-200" />}

        {/* Pickup */}
        <button
          onClick={() => props.onFieldClick('pickup')}
          className={`w-full flex items-center gap-2.5 py-2 px-2 rounded-lg transition-all text-left cursor-pointer ${
            selecting === 'pickup' ? 'bg-primary-50/70 ring-1 ring-primary-200' : 'hover:bg-background-50'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-primary-500 border-2 border-primary-100 flex-shrink-0" />
          <span
            className={`text-sm flex-1 min-w-0 truncate ${
              props.pickup ? 'text-foreground-900 font-medium' : 'text-foreground-400'
            }`}
          >
            {props.pickup ? props.pickup.address : t('set_pickup')}
          </span>
          {props.pickup && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onClearPickup();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
              aria-label="clear pickup"
            >
              <i className="ri-close-line text-foreground-300 text-sm" />
            </button>
          )}
        </button>

        {/* Swap */}
        {hasRoute && (
          <button
            onClick={props.onSwap}
            className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 rounded-full bg-white border border-background-200 flex items-center justify-center hover:border-primary-300 hover:text-primary-600 transition-all cursor-pointer"
            aria-label={t('swap_routes')}
          >
            <i className="ri-arrow-up-down-line text-foreground-500 text-xs" />
          </button>
        )}

        {/* Destination */}
        <button
          onClick={() => props.onFieldClick('dest')}
          className={`w-full flex items-center gap-2.5 py-2 px-2 rounded-lg transition-all text-left cursor-pointer ${
            selecting === 'dest' ? 'bg-primary-50/70 ring-1 ring-primary-200' : 'hover:bg-background-50'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-sm bg-foreground-400 flex-shrink-0" />
          <span
            className={`text-sm flex-1 min-w-0 truncate ${
              props.destination ? 'text-foreground-900 font-medium' : 'text-foreground-400'
            }`}
          >
            {props.destination ? props.destination.address : t('set_destination')}
          </span>
          {props.destination && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onClearDestination();
              }}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
              aria-label="clear destination"
            >
              <i className="ri-close-line text-foreground-300 text-sm" />
            </button>
          )}
        </button>
      </div>

      {/* Route summary */}
      {hasRoute && props.fare && (
        <div className="px-3 pt-1">
          <button
            onClick={props.onToggleFareDetails}
            className="w-full bg-background-50 rounded-lg px-3 py-2 flex items-center justify-between gap-2 cursor-pointer"
          >
            <div className="flex items-center gap-3 text-xs min-w-0">
              <span className="flex items-center gap-1 text-foreground-500 whitespace-nowrap">
                <i className="ri-road-map-line text-foreground-400" />
                {props.fare.distanceKm.toFixed(1)} {t('km')}
              </span>
              <span className="w-px h-3 bg-background-200 flex-shrink-0" />
              <span className="flex items-center gap-1 text-foreground-500 whitespace-nowrap">
                <i className="ri-time-line text-foreground-400" />
                {props.fare.durationMin} {t('min')}
              </span>
            </div>
            <span
              key={props.fare.total}
              className="text-sm font-bold text-primary-600 whitespace-nowrap flex-shrink-0 pop-in"
            >
              {props.priceIsEstimate && <span className="text-foreground-400 font-medium">~</span>}
              {props.fare.total.toFixed(2)} {t('lv')}
            </span>
            <i
              className={`ri-arrow-down-s-line text-foreground-400 text-sm flex-shrink-0 transition-transform ${
                props.showFareDetails ? 'rotate-180' : ''
              }`}
            />
          </button>

          {props.showFareDetails && (
            <div className="mt-1.5 bg-background-50 rounded-lg px-3 py-2 space-y-1 animate-in fade-in duration-200">
              {props.priceIsEstimate && (
                <p className="text-[10px] text-foreground-400 flex items-center gap-1 pb-1">
                  <i className="ri-information-line" />
                  {t('price_approx')}
                </p>
              )}
              <div className="flex justify-between text-xs text-foreground-500">
                <span>{t('base_fare')}</span>
                <span className="font-medium text-foreground-700">
                  {props.fare.baseFare.toFixed(2)} {t('lv')}
                </span>
              </div>
              <div className="flex justify-between text-xs text-foreground-500">
                <span>
                  {props.fare.distanceKm.toFixed(1)} {t('km')} &times; {props.fare.perKm.toFixed(2)} {t('lv')}
                  {t('per_km')}
                </span>
                <span className="font-medium text-foreground-700">
                  {props.fare.distanceCost.toFixed(2)} {t('lv')}
                </span>
              </div>
              <div className="flex justify-between text-xs text-foreground-500">
                <span>
                  {props.fare.durationMin} {t('min')} &times; {props.fare.perMin.toFixed(2)} {t('lv')}
                  {t('per_min')}
                </span>
                <span className="font-medium text-foreground-700">
                  {props.fare.timeCost.toFixed(2)} {t('lv')}
                </span>
              </div>
              <div className="flex justify-between text-sm font-bold text-foreground-950 pt-1.5 border-t border-background-200">
                <span>{t('total')}</span>
                <span className="text-primary-600">
                  {props.fare.total.toFixed(2)} {t('lv')}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vehicle + payment */}
      {hasRoute && (
        <div className="px-3 pt-1.5 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {props.vehicleOptions.map((v) => {
              const active = props.vehicleType === v.id;
              return (
                <button
                  key={v.id}
                  onClick={() => props.onVehicleTypeChange(v.id)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-foreground-950 text-white'
                      : 'bg-background-100 text-foreground-500 hover:bg-background-200 active:scale-[0.97]'
                  }`}
                >
                  <i className={`${v.icon} text-sm ${active ? 'text-white' : 'text-foreground-400'}`} />
                  {v.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {PAYMENT_OPTIONS.map((m) => {
              const active = props.paymentMethod === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => props.onPaymentMethodChange(m.id)}
                  className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-primary-500 text-white'
                      : 'bg-background-100 text-foreground-500 hover:bg-background-200 active:scale-[0.97]'
                  }`}
                >
                  <i className={`${m.icon} text-sm ${active ? 'text-white' : 'text-foreground-400'}`} />
                  {t(`payment_${m.id}`)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="p-3">
        <button
          onClick={props.onRequest}
          disabled={!props.canRequest}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-all duration-200 whitespace-nowrap cursor-pointer flex items-center justify-center gap-2 ${
            props.canRequest
              ? 'bg-primary-500 text-white hover:bg-primary-600 active:scale-[0.98]'
              : 'bg-background-200 text-foreground-400 cursor-not-allowed'
          }`}
        >
          {props.creating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {t('creating_request')}
            </>
          ) : (
            <>
              <i className="ri-taxi-line text-lg" />
              {t('request_taxi')}
              {props.fare && (
                <span className="px-3 py-1 rounded-full bg-white/15 text-sm font-bold">
                  {props.priceIsEstimate && <span className="opacity-70">~</span>}
                  {props.fare.total.toFixed(2)} {t('lv')}
                </span>
              )}
            </>
          )}
        </button>
        {props.requestError && (
          <p className="text-xs text-red-500 text-center mt-2 flex items-center justify-center gap-1">
            <i className="ri-error-warning-line" /> {props.requestError}
          </p>
        )}
      </div>
    </div>
  );
}