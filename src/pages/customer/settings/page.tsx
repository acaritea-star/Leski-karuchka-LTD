import BackButton from '@/components/feature/BackButton';
import LocationSettings from '@/components/feature/LocationSettings';
import PrivacyRequests from '@/components/feature/PrivacyRequests';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import NotificationSettings from '@/components/feature/NotificationSettings';
import { supabase } from '@/lib/supabase';
import AppMenu from '@/pages/customer/components/AppMenu';
import { withRequestTimeout } from '@/lib/requestTimeout';

export default function CustomerSettings() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  const languageLatch = useRef(false);
  const [changingLanguage, setChangingLanguage] = useState(false);
  const [languageSyncError, setLanguageSyncError] = useState(false);
  const [lang, setLang] = useState<'bg' | 'en'>(() =>
    i18n.language?.startsWith('en') ? 'en' : 'bg',
  );

  const changeLang = async (lng: 'bg' | 'en') => {
    if (languageLatch.current) return;
    languageLatch.current = true; setChangingLanguage(true); setLanguageSyncError(false); setLang(lng);
    try {
      await i18n.changeLanguage(lng);
      if (user?.id) {
        const { data, error } = await withRequestTimeout(signal => supabase.from('profiles').update({ language: lng })
          .eq('id', user.id).select('id').abortSignal(signal).single());
        if (error || !data) throw error || new Error('Unconfirmed preference');
      }
    } catch { setLanguageSyncError(true); }
    finally { languageLatch.current = false; setChangingLanguage(false); }
  };

  const initials = `${user?.first_name?.charAt(0) || ''}${user?.last_name?.charAt(0) || ''}`;

  return (
    <div className="min-h-screen bg-background-50">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl sticky top-0 z-50 border-b border-background-100 px-4 py-3 flex items-center gap-3">
        <BackButton to="/customer/home" />
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
                disabled={changingLanguage} aria-pressed={lang === 'bg'}
                onClick={() => changeLang('bg')}
                className={`flex-1 min-h-11 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                  lang === 'bg'
                    ? 'bg-white text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                Български
              </button>
              <button
                type="button"
                disabled={changingLanguage} aria-pressed={lang === 'en'}
                onClick={() => changeLang('en')}
                className={`flex-1 min-h-11 py-2 rounded-full text-sm font-medium transition-all duration-200 whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                  lang === 'en'
                    ? 'bg-white text-foreground-950 shadow-sm'
                    : 'text-foreground-500 hover:text-foreground-700'
                }`}
              >
                English
              </button>
            </div>
            {languageSyncError && <p role="alert" className="mt-3 text-xs text-red-600">{t('settings_language_sync_error')} <button type="button" disabled={changingLanguage} className="min-h-11 underline" onClick={() => void changeLang(lang)}>{t('retry')}</button></p>}
          </div>

          <LocationSettings />

          <NotificationSettings />

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

        <PrivacyRequests />
        <div className="h-8" />
      </div>
    </div>
  );
}
