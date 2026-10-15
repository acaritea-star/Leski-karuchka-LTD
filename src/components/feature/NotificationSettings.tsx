import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { pushSupported } from '@/lib/pushSubscription';

export default function NotificationSettings() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { enabled, permission, enabling, enable, unregister } = usePushNotifications();
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const supported = pushSupported();
  const toggle = async () => {
    if (!user || busy.current) return;
    busy.current = true; setError(false);
    try { const ok = enabled ? await unregister(user.id) : await enable(user.id); setError(!ok); }
    finally { busy.current = false; }
  };
  return <section className="bg-white rounded-2xl p-4 mt-3 mb-4 border border-background-100">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-sm font-semibold text-foreground-800">{t('settings_notifications')}</h2>
        <p className="text-xs text-foreground-500 mt-1">{t('notifications_device_preference')}</p></div>
      <button type="button" role="switch" aria-checked={enabled} aria-label={t('settings_notifications')}
        disabled={enabling || !supported || permission === 'denied'} onClick={() => void toggle()}
        className="min-w-11 min-h-11 shrink-0 flex items-center justify-center disabled:opacity-50">
        <span className={`relative block w-11 h-6 rounded-full ${enabled ? 'bg-primary-500' : 'bg-background-300'}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </span>
      </button>
    </div>
    <p role="status" className="text-xs text-foreground-500 mt-2">{t(permission === 'denied' ? 'notifications_browser_blocked' : !supported ? 'notifications_browser_unsupported' : enabled ? 'enable_notifications_done' : 'notifications_device_off')}</p>
    {error && <p role="alert" className="text-sm text-red-600 mt-2">{t('enable_notifications_error')}</p>}
  </section>;
}
