import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { getPushPreference, pushSupported } from '@/lib/pushSubscription';
import { useNavigate } from 'react-router-dom';

const DISMISS_KEY = 'leski_notifications_dismissed';

export default function EnableNotificationsBanner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { enable, permission, enabling, enabled } = usePushNotifications();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY + ':' + user?.id) === 'true';
    } catch {
      return false;
    }
  });
  const [error, setError] = useState(false);

  if (!user?.id) return null;
  if (dismissed) return null;
  if (enabled) return null;
  if (getPushPreference(user.id) === false) return null;
  const needsSettings = permission === 'denied' || !pushSupported();

  const persistDismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY + ':' + user.id, 'true');
    } catch {
      /* ignore */
    }
  };

  const handleEnable = async () => {
    setError(false);
    if (needsSettings) { navigate(user.role === 'DRIVER' ? '/driver/profile' : user.role === 'CUSTOMER' ? '/customer/settings' : '/admin/settings'); return; }
    const ok = await enable(user.id);
    if (ok) {
      persistDismiss();
    } else {
      setError(true);
    }
  };

  return (
    <div aria-label="Настройка на известията" className="mx-4 my-1 grid grid-cols-[32px_minmax(0,1fr)_44px] items-start gap-x-2.5 gap-y-2 rounded-xl bg-accent-50 border border-accent-100 px-3 py-2">
      <span className="w-8 h-8 rounded-lg bg-accent-100 flex items-center justify-center flex-shrink-0">
        <i className="ri-notification-3-line text-accent-600 text-base" />
      </span>
      <p className="flex-1 min-w-0 text-[14px] font-medium text-foreground-800 leading-snug break-words">
        {error ? t('enable_notifications_error') : permission === 'denied' ? t('notifications_browser_blocked') : !pushSupported() ? t('notifications_browser_unsupported') : t('enable_notifications_desc')}
      </p>
      {(
        <button
          onClick={handleEnable}
          disabled={enabling}
          className="col-start-2 row-start-2 justify-self-start min-h-11 px-3.5 py-1.5 rounded-lg bg-primary-500 text-white text-[14px] font-semibold hover:bg-primary-600 transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
        >
          {enabling ? '…' : needsSettings ? t('nav_settings') : error ? t('retry') : t('enable_notifications_btn')}
        </button>
      )}
      <button
        onClick={persistDismiss}
        aria-label={t('cancel')}
        className="col-start-3 row-start-1 w-11 h-11 flex items-center justify-center rounded-full text-foreground-400 hover:text-foreground-600 hover:bg-background-200 transition-colors cursor-pointer flex-shrink-0"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}
