import BrandLogo from '@/components/feature/BrandLogo';
import { beginPartnerLogin, consumeAuthReturn, invitationId, partnerEntryPath } from '@/lib/authReturn';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth';
import { socialAuthErrorKey, type SocialProvider } from '@/lib/socialAuth';
import { legalOperator } from '@/config/legal';
import { beginLegalIntent } from '@/lib/legalAcceptance';

export default function SocialAuthPage({ mode, audience = 'general' }: { mode: 'login' | 'register'; audience?: 'general' | 'company' | 'driver' }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const invite = invitationId(location.search);
  const { session, loading, signInWithOAuth } = useAuth();
  const [pending, setPending] = useState<SocialProvider | null>(null);
  const [error, setError] = useState('');
  const requestInFlight = useRef(false);
  const redirected = useRef(false);
  const registering = mode === 'register';
  const companyLogin = audience === 'company';
  const partnerLogin = audience !== 'general';

  useEffect(() => {
    if (!loading && session && !redirected.current) {
      redirected.current = true;
      const destination = consumeAuthReturn();
      navigate(partnerLogin ? partnerEntryPath(audience as 'company' | 'driver', invite) : destination, { replace: true });
    }
  }, [loading, session, navigate, partnerLogin, audience, invite]);

  const handleSignIn = async (provider: SocialProvider) => {
    if (requestInFlight.current || loading || session) return;
    requestInFlight.current = true;
    setPending(provider);
    setError('');
    try {
      if (partnerLogin) beginPartnerLogin(audience as 'company' | 'driver', invite);
      beginLegalIntent(provider);
      const result = await signInWithOAuth(provider);
      if (result.error) throw result.error;
      if (!result.data.url) throw new Error('missing_oauth_url');
      // Keep both buttons disabled until Supabase redirects the browser.
    } catch (signInError) {
      setError(t(socialAuthErrorKey(signInError)));
      setPending(null);
      requestInFlight.current = false;
    }
  };

  const disabled = loading || !!session || pending !== null;
  return <div className="brand-scope min-h-[100dvh] flex flex-col">
    <header className="w-full px-4 md:px-6 h-16 flex items-center justify-between border-b border-background-200/60">
      <Link to="/" className="flex items-center gap-2" aria-label={t('auth_home')}>
        <BrandLogo alt={t('app_name')} className="h-8 w-auto rounded-lg" />
      </Link>
      <a href={'tel:' + legalOperator.phone} aria-label={t('auth_support_phone')}
        className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors whitespace-nowrap">
        <i className="ri-phone-line" aria-hidden="true" />
        {t('landing.footer_phone')}
      </a>
    </header>
    <main className="flex-1 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <BrandLogo alt="" className="h-14 w-auto mx-auto mb-3 rounded-lg" />
          <h1 className="text-xl font-semibold text-foreground-950 font-heading tracking-tight">
            {partnerLogin ? companyLogin ? 'Вход за фирми' : 'Вход за шофьори' : t('app_name')}
          </h1>
          <p className="text-foreground-500 text-sm mt-1">{partnerLogin ? 'Влез с точния имейл, на който получи поканата. Данните и подготовката са след входа.' : t(registering ? 'register_cta' : 'login_cta')}</p>
        </div>

        <div className="bg-background-50 border border-background-200 rounded-xl p-6 space-y-4" aria-busy={!!pending}>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="space-y-3">
            <button type="button" onClick={() => void handleSignIn('google')} disabled={disabled} aria-describedby="auth-legal-notice"
              className="w-full min-h-12 px-4 py-3 flex items-center justify-center gap-3 bg-white border border-background-200 rounded-xl text-sm font-medium text-foreground-800 hover:bg-background-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait">
              <svg className="size-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              {t('auth_continue_google')}
            </button>
            <button type="button" onClick={() => void handleSignIn('facebook')} disabled={disabled} aria-describedby="auth-legal-notice"
              className="w-full min-h-12 px-4 py-3 flex items-center justify-center gap-3 bg-white border border-background-200 rounded-xl text-sm font-medium text-foreground-800 hover:bg-background-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-wait">
              <svg className="size-5 shrink-0 fill-[#1877F2]" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.026 4.388 11.021 10.125 11.927v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.973h-1.513c-1.491 0-1.956.931-1.956 1.887v2.261h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.099 24 12.073z" />
              </svg>
              {t('auth_continue_facebook')}
            </button>
          </div>

          {(pending || loading) && <p role="status" className="flex items-center justify-center gap-2 text-sm text-foreground-600">
            <span className="size-4 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            {pending ? t('auth_redirecting', { provider: pending === 'google' ? 'Google' : 'Facebook' }) : t('loading')}
          </p>}
          <p id="auth-legal-notice" className="text-center text-xs leading-relaxed text-foreground-600">
            {t('auth_continue_accept_prefix')}{' '}<Link className="underline text-primary-700" to="/terms">{t('menu_terms')}</Link>.
            {' '}{t('auth_data_notice_prefix')}{' '}<Link className="underline text-primary-700" to="/privacy">{t('auth_privacy_label')}</Link>.
          </p>

          {partnerLogin ? <p className="text-center text-xs text-foreground-500">{companyLogin ? 'Фирменият достъп се предоставя от Лески Каручка.' : 'Шофьорският достъп се предоставя от твоята фирма.'} При Facebook без същия потвърден имейл използвай Google или поискай нова покана.</p> : <p className="text-center mt-5 text-sm text-foreground-500">
            {t(registering ? 'have_account' : 'no_account')}{' '}
            <Link to={registering ? '/auth/login' : '/auth/register'} className="text-primary-600 hover:text-primary-700 font-semibold transition-colors">
              {t(registering ? 'login_here' : 'register_here')}
            </Link>
          </p>}
          {partnerLogin ? <Link to="/auth/login" className="block text-center text-xs text-foreground-500 underline">Към клиентския вход</Link> :
            <details className="text-center text-xs text-foreground-500">
              <summary className="cursor-pointer">За фирми и шофьори</summary>
              <div className="flex justify-center gap-5 pt-3"><Link to="/company/login" className="underline">Вход за фирми</Link><Link to="/driver/login" className="underline">Вход за шофьори</Link></div>
            </details>}
        </div>
      </div>
    </main>
  </div>;
}
