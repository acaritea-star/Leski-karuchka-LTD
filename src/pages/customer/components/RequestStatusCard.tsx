import { useTranslation } from 'react-i18next';

export interface RequestData {
  id: string;
  status: string;
  pickup_address: string;
  destination_address: string;
  estimated_price: number | null;
  cancelled_by?: string | null;
}

interface RequestStatusCardProps {
  request: RequestData;
  price: number | null;
  confirmCancel: boolean;
  onShowCancel: () => void;
  onKeepRequest: () => void;
  onCancel: () => void;
  onReset: () => void;
  onShare: () => void;
  onNewOrder?: () => void;
  requestError: string;
}

export default function RequestStatusCard(props: RequestStatusCardProps) {
  const { t } = useTranslation();
  const { request } = props;
  const status = request.status;

  const isPending = status === 'pending';
  const isCompleted = status === 'completed';
  const isCancelled = status === 'cancelled';
  const isFinal = isCompleted || isCancelled;
  const noDriver = isCancelled && request.cancelled_by === 'system';

  const progressSteps = ['pending', 'accepted', 'arrived', 'in_progress', 'completed'];
  const stepIndex = progressSteps.indexOf(status);
  const currentStep = stepIndex >= 0 ? stepIndex : 0;

  return (
    <div className="bg-white/95 backdrop-blur-xl rounded-2xl border border-background-100 p-3 text-center animate-in zoom-in-95 fade-in duration-300">
      {/* Status icon */}
      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center mx-auto mb-2">
        {isPending && (
          <div className="relative">
            <i className="ri-search-line text-lg text-primary-600 animate-pulse" />
            <div className="absolute inset-0 rounded-full border-2 border-primary-400 animate-ping opacity-20" />
          </div>
        )}
        {status === 'accepted' && <i className="ri-user-star-line text-lg text-accent-600" />}
        {status === 'arrived' && <i className="ri-car-line text-lg text-accent-600 animate-bounce" />}
        {status === 'in_progress' && <i className="ri-roadster-line text-lg text-accent-600" />}
        {isCompleted && <i className="ri-check-double-line text-lg text-accent-600" />}
        {isCancelled && !noDriver && <i className="ri-close-circle-line text-lg text-red-500" />}
        {noDriver && <i className="ri-user-search-line text-lg text-red-500" />}
      </div>

      {/* Title */}
      <h2 className="text-sm font-bold text-foreground-950 font-heading mb-0.5">
        {noDriver ? t('no_driver_available') : t(`status_${status}`)}
      </h2>

      {isPending && <p className="text-[11px] text-foreground-500">{t('searching_driver')}</p>}
      {status === 'accepted' && <p className="text-[11px] text-foreground-500">{t('driver_assigned')}</p>}
      {status === 'arrived' && <p className="text-[11px] text-foreground-500">{t('driver_waiting')}</p>}
      {status === 'in_progress' && <p className="text-[11px] text-foreground-500">{t('trip_started')}</p>}
      {isCompleted && (
        <>
          <p className="text-[11px] text-foreground-500">{t('trip_completed')}</p>
          {props.price && (
            <p className="text-base font-bold text-primary-600 font-heading mt-0.5">
              {props.price.toFixed(2)} {t('lv')}
            </p>
          )}
        </>
      )}
      {isCancelled && !noDriver && <p className="text-[11px] text-foreground-500">{t('cancelled')}</p>}
      {noDriver && <p className="text-[11px] text-foreground-500">{t('no_driver_available_desc')}</p>}

      {/* Progress dots */}
      {!isFinal && (
        <div className="flex justify-center gap-1.5 mt-2 mb-2">
          {progressSteps.map((s, i) => (
            <div
              key={s}
              className={`w-2 h-2 rounded-full transition-colors ${
                i <= currentStep ? 'bg-primary-500' : 'bg-background-200'
              }`}
            />
          ))}
        </div>
      )}

      {/* Route snippet */}
      <div className="flex items-start gap-2 bg-background-50 rounded-xl p-2 mt-1.5 text-left">
        <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
          <div className="w-2 h-2 rounded-full bg-primary-500" />
          <div className="w-px h-4 bg-background-200 my-0.5" />
          <div className="w-2 h-2 rounded-sm bg-foreground-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-foreground-900 truncate">{request.pickup_address}</p>
          <p className="text-[11px] text-foreground-500 truncate mt-1">{request.destination_address}</p>
        </div>
      </div>

      {/* Share trip */}
      {!isFinal && (
        <button
          onClick={props.onShare}
          className="mt-2 w-full py-2 rounded-xl bg-background-100 text-foreground-700 text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
        >
          <i className="ri-share-forward-line" />{t('share_trip')}
        </button>
      )}

      {/* Cancel for pending */}
      {isPending && !props.confirmCancel && (
        <button
          onClick={props.onShowCancel}
          className="mt-2 w-full py-2 rounded-xl bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
        >
          <i className="ri-close-circle-line" />{t('cancel_request')}
        </button>
      )}

      {isPending && props.confirmCancel && (
        <div className="mt-2 bg-red-50 rounded-xl p-2.5 animate-in fade-in duration-200">
          <p className="text-xs text-red-700 text-center mb-2">{t('confirm_cancel')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={props.onKeepRequest}
              className="py-2 rounded-xl bg-white text-foreground-600 text-xs font-semibold hover:bg-background-50 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('keep_request')}
            </button>
            <button
              onClick={props.onCancel}
              className="py-2 rounded-xl bg-red-500 text-white text-xs font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap"
            >
              {t('yes_cancel')}
            </button>
          </div>
        </div>
      )}

      {props.requestError && (
        <p className="text-xs text-red-500 text-center mt-2">{props.requestError}</p>
      )}

      {/* Final actions: new order + orders */}
      {isFinal && (
        <div className="mt-2 space-y-2">
          {props.onNewOrder && (
            <button
              onClick={props.onNewOrder}
              className="w-full py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
            >
              <i className="ri-taxi-line" />
              {t('order_new_taxi')}
            </button>
          )}
          <button
            onClick={props.onReset}
            className="w-full py-2 rounded-xl bg-background-100 text-foreground-700 text-xs font-medium hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            {t('nav_orders')}
          </button>
        </div>
      )}
    </div>
  );
}