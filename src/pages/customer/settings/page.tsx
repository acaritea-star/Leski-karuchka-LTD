import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { supabase } from '@/lib/supabase';
import AppMenu from '@/pages/customer/components/AppMenu';

export default function CustomerSettings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { enabled: notifications, enable, unregister, enabling } = usePushNotifications();
  const [notificationError, setNotificationError] = useState(false);
  const [lang, setLang] = useState<'bg' | 'en'>(() =>
    i18n.language?.startsWith('en') ? 'en' : 'bg',
  );

  const toggleNotifications = async () => {
    if (!user) return;
    setNotificationError(false);
    const ok = notifications ? await unregister(user.id) : await enable(user.id);
    setNotificationError(!ok);
  };

  const changeLang = async (lng: 'bg' | 'en') => {
    setLang(lng);
    i18n.changeLanguage(lng);
    if (user?.id) {
      await supabase.from('profiles').update({ language: lng }).eq('id', user.id);
    }
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-background-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate('/customer/home')}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-background-100 transition-colors cursor-pointer"
        >
          <i className="ri-arrow-left-line text-foreground-600 text-lg" />
        </button>
        <h1 className="text-lg font-bold text-foreground-950 font-heading flex-1">
          {t('nav_settings')}
        </h1>
        <AppMenu />
      </header>

      <div className="p-4 space-y-4">
        {/* Account */}
        <section>
          <h2 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-2 px-1">
            {t('settings_section_account')}
          </h2>
          <div className="bg-white rounded-2xl overflow-hidden">
            <button
              type="button"
              onClick={() => navigate('/customer/profile')}
              className="w-full flex items-center gap-3 p-4 hover:bg-background-50 transition-colors cursor-pointer text-left"
            >
              <div className="w-11 h-11 rounded-full bg-primary-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                {user?.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="w-11 h-11 rounded-full object-cover"
                  />
                ) : (
                  <span className="text-base font-bold text-primary-600 font-heading">
                    {initials}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground-950">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-foreground-500 truncate">{t('settings_personal_desc')}</p>
              </div>
              <i className="ri-arrow-right-s-line text-foreground-400 text-lg" />
            </button>
          </div>
        </section>

        {/* Preferences */}
        <section>
          <h2 className="text-xs font-semibold text-foreground-400 uppercase tracking-wide mb-2 px-1">
            {t('settings_section_preferences')}
          </h2>

          {/* Language */}
          <div className="bg-white rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <i className="ri-translate-2 text-foreground-500 text-lg" />
              <span className="text-sm font-medium text-foreground-800">
                {t('settings_language')}
              </span>
            </div>
            <div className="flex bg-background-100 rounded-full p-1">
              <button
                type="button"
                onClick={() => changeLang('bg')}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  lang === 'bg'
                    ? 'bg-white text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                Български
              </button>
              <button
                type="button"
                onClick={() => changeLang('en')}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer ${
                  lang === 'en'
                    ? 'bg-white text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                English
              </button>
            </div>
          </div>

          {/* Notifications */}
          <div className="bg-white rounded-2xl p-4 mt-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                <i className="ri-notification-3-line text-foreground-500 text-lg mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground-800">
                    {t('settings_notifications')}
                  </p>
                  <p className="text-xs text-foreground-400 mt-0.5">
                    {t('settings_notifications_desc')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifications}
                aria-label={t('settings_notifications')}
                disabled={enabling}
                onClick={toggleNotifications}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                  notifications ? 'bg-primary-500' : 'bg-background-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-200 ${
                    notifications ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            {notificationError && <p role="alert" className="text-sm text-red-600 mt-2">{t('enable_notifications_error')}</p>}
          </div>

          {/* Default payment */}
          <div className="bg-white rounded-2xl p-4 mt-3">
            <div className="flex items-center gap-2 mb-3">
              <i className="ri-wallet-3-line text-foreground-500 text-lg" />
              <span className="text-sm font-medium text-foreground-800">
                {t('settings_payment_default')}
              </span>
            </div>
            <p className="flex items-center gap-2 text-sm font-medium">
              <i className="ri-cash-line" /> {t('payment_cash')}
            </p>
          </div>
        </section>

        <div className="h-8" />
      </div>
    </div>
  );
}
