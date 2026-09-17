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
  const noDriver = isCancelled && request.cancelled_by === 'system';

  if (isPending) {
    return (
      <div className="bg-white px-5 py-4">
        {/* Compact searching header — small loader, no big icon */}
        <div className="flex items-center gap-3">
          <span className="w-5 h-5 border-2 border-primary-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[17px] font-bold text-foreground-950 font-heading leading-snug">
              {t('searching_driver_title')}
            </h2>
            <p className="text-[14px] text-foreground-500">{t('searching_driver_hint')}</p>
          </div>
        </div>

        {/* Pickup / destination */}
        <div className="mt-4 rounded-2xl bg-background-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <div className="flex flex-col items-center pt-1 flex-shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-primary-500" />
              <span className="w-px flex-1 min-h-[20px] bg-background-200 my-1" />
              <span className="w-2.5 h-2.5 rounded-sm bg-foreground-400" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div>
                <p className="text-[12px] text-foreground-500">{t('pickup_point')}</p>
                <p className="text-[15px] font-medium text-foreground-900 leading-snug line-clamp-2">
                  {request.pickup_address}
                </p>
              </div>
              <div>
                <p className="text-[12px] text-foreground-500">{t('destination_point')}</p>
                <p className="text-[15px] font-medium text-foreground-900 leading-snug line-clamp-2">
                  {request.destination_address}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-3 space-y-1.5">
          <button
            onClick={props.onShare}
            className="w-full py-2.5 rounded-2xl bg-background-50 text-foreground-700 text-[15px] font-medium hover:bg-background-100 transition-colors cursor-pointer flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <i className="ri-share-forward-line text-base" />
            {t('share_trip')}
          </button>

          {!props.confirmCancel ? (
            <button
              onClick={props.onShowCancel}
              className="w-full py-2 text-[14px] font-medium text-foreground-500 hover:text-red-600 transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap"
            >
              {t('cancel_request')}
            </button>
          ) : (
            <div className="rounded-2xl bg-red-50 p-3 animate-in fade-in duration-200">
              <p className="text-[14px] text-red-700 text-center mb-2">{t('confirm_cancel')}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={props.onKeepRequest}
                  className="py-2.5 rounded-xl bg-white text-foreground-600 text-[14px] font-semibold hover:bg-background-50 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {t('keep_request')}
                </button>
                <button
                  onClick={props.onCancel}
                  className="py-2.5 rounded-xl bg-red-500 text-white text-[14px] font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap"
                >
                  {t('yes_cancel')}
                </button>
              </div>
            </div>
          )}
        </div>

        {props.requestError && (
          <p className="text-[14px] text-red-500 text-center mt-2">{props.requestError}</p>
        )}
      </div>
    );
  }

  // Final / transitional states: completed, cancelled (or accepted before driver assigned)
  return (
    <div className="bg-white px-5 py-5 text-center">
      <h2 className="text-[17px] font-bold text-foreground-950 font-heading">
        {noDriver ? t('no_driver_available') : t(`status_${status}`)}
      </h2>
      <p className="text-[14px] text-foreground-500 mt-1">
        {noDriver
          ? t('no_driver_available_desc')
          : isCompleted
            ? t('trip_completed')
            : t('cancelled')}
      </p>
      {isCompleted && props.price && (
        <p className="text-[18px] font-bold text-primary-600 font-heading mt-1.5">
          {props.price.toFixed(2)} {t('lv')}
        </p>
      )}

      <div className="mt-4 rounded-2xl bg-background-50 p-3.5 text-left">
        <p className="text-[12px] text-foreground-500">{t('pickup_point')}</p>
        <p className="text-[15px] text-foreground-900 leading-snug line-clamp-2">
          {request.pickup_address}
        </p>
        <p className="text-[12px] text-foreground-500 mt-2">{t('destination_point')}</p>
        <p className="text-[15px] text-foreground-900 leading-snug line-clamp-2">
          {request.destination_address}
        </p>
      </div>

      <div className="mt-3 space-y-2">
        {props.onNewOrder && (
          <button
            onClick={props.onNewOrder}
            className="w-full py-3 rounded-2xl bg-primary-500 text-white text-[16px] font-semibold hover:bg-primary-600 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-taxi-line" />
            {t('order_new_taxi')}
          </button>
        )}
        <button
          onClick={props.onReset}
          className="w-full py-2 text-[14px] font-medium text-foreground-500 hover:text-foreground-700 transition-colors cursor-pointer whitespace-nowrap"
        >
          {t('nav_orders')}
        </button>
      </div>

      {props.requestError && (
        <p className="text-[14px] text-red-500 text-center mt-2">{props.requestError}</p>
      )}
    </div>
  );
}