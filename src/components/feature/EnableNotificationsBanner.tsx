import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';

const DISMISS_KEY = 'leski_notifications_dismissed';

export default function EnableNotificationsBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { enable, permission, enabling } = usePushNotifications();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);

  if (!user?.id) return null;
  if (dismissed) return null;
  if (permission === 'granted') return null;
  if (permission === 'denied') return null;

  const persistDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      /* ignore */
    }
  };

  const handleEnable = async () => {
    setError(false);
    const ok = await enable(user.id);
    if (ok) {
      setDone(true);
      window.setTimeout(persistDismiss, 2500);
    } else {
      setError(true);
    }
  };

  if (done) {
    return (
      <div className="mx-4 my-1 flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2.5">
        <i className="ri-check-line text-emerald-500 text-base" />
        <p className="text-[14px] font-medium text-emerald-700 flex-1">
          {t('enable_notifications_done')}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-4 my-1 flex items-center gap-2.5 rounded-xl bg-accent-50 border border-accent-100 px-3 py-2">
      <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center flex-shrink-0">
        <i className="ri-notification-3-line text-accent-600 text-base" />
      </span>
      <p className="flex-1 min-w-0 text-[14px] font-medium text-foreground-800 leading-snug truncate">
        {error ? t('enable_notifications_error') : t('enable_notifications_desc')}
      </p>
      {!error && (
        <button
          onClick={handleEnable}
          disabled={enabling}
          className="px-3.5 py-1.5 rounded-lg bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          {enabling ? '…' : t('enable_notifications_btn')}
        </button>
      )}
      <button
        onClick={persistDismiss}
        aria-label={t('cancel')}
        className="w-7 h-7 flex items-center justify-center rounded-full text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
      >
        <i className="ri-close-line" />
      </button>
    </div>
  );
}