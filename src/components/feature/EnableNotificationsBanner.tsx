import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

export default function EnableNotificationsBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { enable, permission, enabling } = usePushNotifications();
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');

  if (!user?.id) return null;
  if (dismissed) return null;
  if (permission === 'granted') return null;

  const isDenied = permission === 'denied';
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const handleEnable = async () => {
    
    setError(false);
    setErrorDetail('');
    const ok = await enable(user.id);
    
    if (ok) {
      setDone(true);
      setTimeout(() => setDismissed(true), 3500);
    } else {
      setError(true);
      if (isDenied) {
        setErrorDetail(t('enable_notifications_blocked_detail') || '');
      } else if (isIOS) {
        setErrorDetail(t('enable_notifications_ios_detail') || '');
      }
    }
  };

  if (done) {
    return (
      <div className="mx-3 md:mx-6 lg:mx-4 mb-2 flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 animate-in fade-in slide-in-from-top-2 duration-300">
        <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <i className="ri-check-line text-white text-sm" />
        </div>
        <p className="text-xs font-medium text-emerald-700">{t('enable_notifications_done')}</p>
      </div>
    );
  }

  return (
    <div className="mx-3 md:mx-6 lg:mx-4 mb-2 flex items-start gap-2.5 rounded-xl bg-background-100 border border-background-200 px-3.5 py-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <i className="ri-notification-3-line text-accent-600 text-base" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground-950 font-heading leading-tight">
          {t('enable_notifications_title')}
        </p>
        <p className="text-xs text-foreground-600 mt-0.5 leading-relaxed">
          {isDenied ? t('enable_notifications_blocked') : t('enable_notifications_desc')}
        </p>
        {error && (
          <div className="mt-1.5">
            <p className="text-xs text-red-600 font-medium leading-relaxed">
              {t('enable_notifications_error')}
            </p>
            {errorDetail && (
              <p className="text-xs text-red-500 mt-0.5 leading-relaxed">
                {errorDetail}
              </p>
            )}
          </div>
        )}
        {!isDenied && (
          <button
            onClick={handleEnable}
            disabled={enabling}
            className="mt-2 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60 active:scale-[0.98]"
          >
            {enabling && <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {t('enable_notifications_btn')}
          </button>
        )}
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label={t('cancel')}
        className="w-6 h-6 flex items-center justify-center rounded-md text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
      >
        <i className="ri-close-line text-sm" />
      </button>
    </div>
  );
}