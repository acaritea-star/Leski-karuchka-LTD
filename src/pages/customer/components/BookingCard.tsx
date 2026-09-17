import { useTranslation } from 'react-i18next';
import type { FareBreakdown } from '@/lib/pricing';
import type { LocationPreset } from '@/lib/geo';

export interface BookingLocation {
  address: string;
  lat: number;
  lng: number;
}

export interface VehicleOption {
  id: string;
  name: string;
  capacity: number;
  available: boolean;
}

interface BookingCardProps {
  pickup: BookingLocation | null;
  destination: BookingLocation | null;
  firstName: string;
  locating: boolean;
  recent: LocationPreset[];
  onSelectRecent: (preset: LocationPreset) => void;
  onFieldClick: (field: 'pickup' | 'dest') => void;
  onClearPickup: () => void;
  onClearDestination: () => void;
  onSwap: () => void;
  onUseMyLocation: () => void;
  vehicleType: string;
  vehicleOptions: VehicleOption[];
  onVehicleTypeChange: (id: string) => void;
  fare: FareBreakdown | null;
  priceIsEstimate?: boolean;
  onRefreshPrice: () => void;
  canRequest: boolean;
  creating: boolean;
  onRequest: () => void;
  requestError: string;
}

/** Map raw DB vehicle-type names to friendly Bulgarian labels. */
function vehicleLabel(name: string, t: (k: string) => string): string {
  const n = name.toLowerCase();
  if (n.includes('eco') || n.includes('econom') || n.includes('standard') || n.includes('иконом')) {
    return t('vehicle_economy');
  }
  if (n.includes('comfort') || n.includes('комфорт')) return t('vehicle_comfort');
  if (n.includes('van') || n.includes('ван') || n.includes('bus')) return t('vehicle_van');
  return name;
}

function vehicleIcon(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('van') || n.includes('ван') || n.includes('bus')) return 'ri-bus-line';
  return 'ri-car-line';
}

export default function BookingCard(props: BookingCardProps) {
  const { t } = useTranslation();
  const hasRoute = !!props.pickup && !!props.destination;
  const recentCount = Math.min(props.recent.length, 3);
  const calculating = hasRoute && !props.fare && !props.creating && !props.requestError;
  const priceExpired = hasRoute && !!props.fare && !props.canRequest && !props.creating;

  return (
    <div className="bg-white">
      {!hasRoute ? (
        /* ============ ADDRESS MODE ============ */
        <div className="px-5 pt-3 pb-5">
          <p className="text-[14px] text-foreground-600 leading-snug">
            {t('greeting_hello')},{' '}
            <span className="font-semibold text-foreground-900">{props.firstName}</span>
          </p>
          <h2 className="mt-0.5 text-[22px] font-bold text-foreground-950 font-heading leading-tight">
            {t('where_to_heading')}
          </h2>

          <div className="mt-3 space-y-2">
            {/* Pickup */}
            <button
              type="button"
              onClick={() => props.onFieldClick('pickup')}
              className="w-full flex items-center gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3 text-left cursor-pointer active:scale-[0.99] transition-all"
            >
              <span className="w-2.5 h-2.5 rounded-full bg-primary-500 flex-shrink-0" />
              <span
                className={`flex-1 min-w-0 text-[17px] truncate ${
                  props.pickup ? 'text-foreground-900' : 'text-foreground-500'
                }`}
              >
                {props.pickup ? props.pickup.address : t('pickup_label')}
              </span>
              {props.pickup && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClearPickup();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      props.onClearPickup();
                    }
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-background-200 cursor-pointer flex-shrink-0"
                  aria-label="clear pickup"
                >
                  <i className="ri-close-line text-foreground-400 text-lg" />
                </span>
              )}
            </button>

            {/* My location */}
            <button
              type="button"
              onClick={props.onUseMyLocation}
              disabled={props.locating}
              className="flex items-center gap-2 text-[14px] font-medium text-primary-700 px-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
            >
              {props.locating ? (
                <span className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              ) : (
                <i className="ri-focus-3-line text-lg" />
              )}
              {props.locating ? t('detecting_location') : t('my_location')}
            </button>

            {/* Destination */}
            <button
              type="button"
              onClick={() => props.onFieldClick('dest')}
              className="w-full flex items-center gap-3 rounded-2xl border border-background-200 bg-background-50 px-4 py-3 text-left cursor-pointer active:scale-[0.99] transition-all"
            >
              <span className="w-2.5 h-2.5 rounded-sm bg-foreground-400 flex-shrink-0" />
              <span
                className={`flex-1 min-w-0 text-[17px] truncate ${
                  props.destination ? 'text-foreground-900' : 'text-foreground-500'
                }`}
              >
                {props.destination ? props.destination.address : t('dest_label')}
              </span>
              {props.destination && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClearDestination();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      props.onClearDestination();
                    }
                  }}
                  className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-background-200 cursor-pointer flex-shrink-0"
                  aria-label="clear destination"
                >
                  <i className="ri-close-line text-foreground-400 text-lg" />
                </span>
              )}
            </button>
          </div>

          {/* Recent (up to 3) */}
          {recentCount > 0 && (
            <div className="mt-3">
              <p className="text-[13px] font-semibold text-foreground-500 mb-1">
                {t('recent_locations')}
              </p>
              <div className="space-y-0.5">
                {props.recent.slice(0, 3).map((preset) => (
                  <button
                    key={`recent-${preset.id}-${preset.address}`}
                    type="button"
                    onClick={() => props.onSelectRecent(preset)}
                    className="w-full flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-background-50 cursor-pointer text-left transition-colors"
                  >
                    <span className="w-8 h-8 rounded-lg bg-background-100 flex items-center justify-center flex-shrink-0">
                      <i className="ri-time-line text-foreground-500 text-base" />
                    </span>
                    <span className="flex-1 min-w-0 text-[15px] text-foreground-900 truncate">
                      {preset.name || preset.address}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ============ ROUTE MODE ============ */
        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          {/* Route summary */}
          <div className="rounded-2xl bg-background-50 p-3.5">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center pt-1 flex-shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-primary-500" />
                <span className="w-px flex-1 min-h-[24px] bg-background-200 my-1" />
                <span className="w-2.5 h-2.5 rounded-sm bg-foreground-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                <button
                  type="button"
                  onClick={() => props.onFieldClick('pickup')}
                  className="w-full text-left cursor-pointer"
                >
                  <p className="text-[12px] text-foreground-500">{t('pickup_label')}</p>
                  <p className="text-[16px] font-medium text-foreground-900 leading-snug line-clamp-2">
                    {props.pickup!.address}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => props.onFieldClick('dest')}
                  className="w-full text-left cursor-pointer"
                >
                  <p className="text-[12px] text-foreground-500">{t('dest_label')}</p>
                  <p className="text-[16px] font-medium text-foreground-900 leading-snug line-clamp-2">
                    {props.destination!.address}
                  </p>
                </button>
              </div>
              <button
                type="button"
                onClick={props.onSwap}
                aria-label={t('swap_routes')}
                className="w-11 h-11 rounded-full border border-background-200 bg-white flex items-center justify-center cursor-pointer flex-shrink-0 active:scale-95 transition-all"
              >
                <i className="ri-arrow-up-down-line text-foreground-600 text-lg" />
              </button>
            </div>
          </div>

          {/* Price row */}
          <div className="mt-2.5 rounded-2xl bg-background-50 px-3.5 py-2.5">
            {calculating ? (
              <div className="flex items-center justify-center gap-2 py-1 text-[14px] text-foreground-600">
                <span className="w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                {t('calculating_price')}
              </div>
            ) : props.fare ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-[14px] text-foreground-700">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <i className="ri-road-map-line text-foreground-500" />
                      {props.fare.distanceKm.toFixed(1)} {t('km')}
                    </span>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <i className="ri-time-line text-foreground-500" />
                      {props.fare.durationMin} {t('min')}
                    </span>
                  </div>
                  <span
                    key={props.fare.total}
                    className="text-[18px] font-bold text-foreground-950 font-heading whitespace-nowrap"
                  >
                    {props.priceIsEstimate && (
                      <span className="text-foreground-500 font-medium text-[13px]">
                        {t('approx_label')}{' '}
                      </span>
                    )}
                    {props.fare.total.toFixed(2)} {t('lv')}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={props.onRefreshPrice}
                  className="mt-1 text-[13px] font-medium text-primary-600 underline cursor-pointer"
                >
                  {t('refresh_price')}
                </button>
              </>
            ) : null}
          </div>

          {/* Vehicle selection */}
          <div className="mt-2.5">
            <p className="text-[13px] font-semibold text-foreground-600 mb-1.5">
              {t('vehicle_type')}
            </p>
            <div className="flex gap-2">
              {props.vehicleOptions.map((v) => {
                const active = props.vehicleType === v.id;
                const disabled = !v.available;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => props.onVehicleTypeChange(v.id)}
                    disabled={disabled}
                    className={`flex-1 min-h-[76px] rounded-2xl border-2 p-2.5 text-left transition-all cursor-pointer ${
                      active
                        ? 'border-primary-500 bg-primary-50'
                        : disabled
                          ? 'border-background-100 bg-background-50 opacity-50 cursor-not-allowed'
                          : 'border-background-200 bg-white hover:border-background-300 active:scale-[0.98]'
                    }`}
                  >
                    <i
                      className={`${vehicleIcon(v.name)} text-lg ${
                        active ? 'text-primary-600' : 'text-foreground-500'
                      }`}
                    />
                    <p
                      className={`mt-1 text-[14px] font-semibold leading-tight ${
                        active ? 'text-primary-700' : 'text-foreground-900'
                      }`}
                    >
                      {vehicleLabel(v.name, t)}
                    </p>
                    <p className="text-[12px] text-foreground-500 leading-snug">
                      {t('vehicle_places', { n: v.capacity })}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment */}
          <div className="mt-2.5 flex items-center justify-between rounded-2xl bg-background-50 px-4 py-2.5">
            <span className="flex items-center gap-2 text-[14px] text-foreground-700">
              <i className="ri-cash-line text-foreground-500 text-base" />
              {t('payment_method')}
            </span>
            <span className="text-[14px] font-semibold text-foreground-900">
              {t('payment_in_cash')}
            </span>
          </div>

          {/* Expired / error */}
          {priceExpired && (
            <p className="mt-2 text-[14px] text-red-600 flex items-start gap-1.5">
              <i className="ri-error-warning-line mt-0.5" />
              {t('price_expired')}
            </p>
          )}
          {props.requestError && !props.creating && (
            <div className="mt-2 flex items-start gap-1.5">
              <i className="ri-error-warning-line text-red-500 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[14px] text-red-600">{props.requestError}</p>
                {!props.fare && (
                  <button
                    type="button"
                    onClick={props.onRefreshPrice}
                    className="mt-1 text-[14px] font-semibold text-primary-600 underline cursor-pointer"
                  >
                    {t('retry')}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* CTA */}
          <button
            type="button"
            onClick={props.onRequest}
            disabled={!props.canRequest || props.creating}
            className={`mt-3 w-full min-h-[56px] rounded-2xl text-[17px] font-bold whitespace-nowrap flex items-center justify-center gap-2 transition-all cursor-pointer ${
              props.canRequest && !props.creating
                ? 'bg-primary-500 text-white hover:bg-primary-600 active:scale-[0.98]'
                : 'bg-background-200 text-foreground-500 cursor-not-allowed'
            }`}
          >
            {props.creating ? (
              <>
                <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {t('creating_request')}
              </>
            ) : (
              <>
                <i className="ri-taxi-line text-xl" />
                {t('order_for')}
                {props.fare && (
                  <>
                    {' '}
                    {props.fare.total.toFixed(2)} {t('lv')}
                  </>
                )}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}