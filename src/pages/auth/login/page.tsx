import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signIn, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [diag, setDiag] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setDiag('');
    setLoading(true);

    try {
      const { data, error: signInError } = await signIn(email, password);

      if (signInError) {
        const msg = signInError.message || '';
        const code = signInError.status ? String(signInError.status) : '';

        if (msg.includes('rate limit') || code === '429' || msg.includes('over_email_send_rate_limit')) {
          setError('Твърде много опити. Моля, изчакайте няколко минути и опитайте отново.');
        } else if (msg === 'Invalid login credentials' || msg.includes('invalid')) {
          setError('Грешен имейл или парола');
        } else if (msg.includes('email') && msg.includes('confirmed')) {
          setError('Имейлът не е потвърден. Моля, проверете пощата си.');
        } else if (msg.includes('provider') || msg.includes('identity')) {
          setError('Проблем с акаунта. Моля, опитайте с друг метод за вход.');
        } else {
          setError(msg);
        }
        if (code) {
          setDiag(`Код: ${code}`);
        }
        setLoading(false);
        return;
      }

      if (!data?.session) {
        setError('Неуспешен вход — няма активна сесия');
        setLoading(false);
        return;
      }

      navigate('/app', { replace: true });
    } catch (err: unknown) {
      setError('Възникна неочаквана грешка. Моля, опитайте отново.');
      setDiag(err instanceof Error ? err.message : '');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setDiag('');
    setLoading(true);

    const { error: oauthError } = await signInWithOAuth('google');
    if (oauthError) {
      const msg = oauthError.message || '';
      if (msg.includes('popup') || msg.includes('blocked')) {
        setError('Popup блокиран от браузъра. Моля, разрешете popup прозорците.');
      } else if (msg.includes('rate')) {
        setError('Твърде много опити. Моля, изчакайте.');
      } else {
        setError('Грешка при вход с Google. Моля, опитайте отново.');
      }
      setDiag(oauthError.message || '');
      setLoading(false);
    }
  };

  return (
    <div className="brand-scope min-h-[100dvh] flex flex-col">
      {/* Minimal top bar */}
      <header className="w-full px-4 md:px-6 h-16 flex items-center justify-between border-b border-background-200/60">
        <Link to="/" className="flex items-center gap-2" aria-label="Лески Каручка — начало">
          <img src={LOGO_URL} alt="Лески Каручка" className="h-8 w-auto rounded-lg" />
        </Link>
        <a
          href="tel:+359890005900"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors whitespace-nowrap"
          aria-label="Телефон за спешни случаи"
        >
          <i className="ri-phone-line" />
          +359 89 000 5900
        </a>
      </header>

      {/* Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          {/* Logo area */}
          <div className="text-center mb-8">
            <img
              src={LOGO_URL}
              alt="Лески Каручка"
              className="h-14 w-auto mx-auto mb-3 rounded-lg"
            />
            <h1 className="text-xl font-semibold text-foreground-950 font-heading tracking-tight">
              {t('app_name')}
            </h1>
            <p className="text-foreground-500 text-sm mt-1">{t('login_cta')}</p>
          </div>

          {/* Card */}
          <div className="bg-background-50 border border-background-200 rounded-xl p-6">
            {/* Google Sign In */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-3 flex items-center justify-center gap-3 bg-white border border-background-200 rounded-xl text-sm font-medium text-foreground-700 hover:bg-background-100 transition-all disabled:opacity-50 cursor-pointer"
              aria-label="Вход с Google"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Вход с Google
            </button>

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-background-200" />
              <span className="text-xs text-foreground-400">или с имейл</span>
              <div className="flex-1 h-px bg-background-200" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 bg-red-50 text-red-600 px-3 py-2.5 rounded-lg text-xs"
                >
                  <i className="ri-error-warning-line text-sm mt-0.5" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <span className="block">{error}</span>
                    {diag && (
                      <span className="block mt-1 text-red-400 text-[10px] font-mono">
                        {diag}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                  {t('email')}
                </label>
                <div className="relative">
                  <i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" aria-hidden="true" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="your@email.com"
                    className="w-full pl-9 pr-4 py-3 rounded-xl border border-background-200 bg-white text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                    aria-label={t('email')}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                  {t('password')}
                </label>
                <div className="relative">
                  <i className="ri-lock-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" aria-hidden="true" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="w-full pl-9 pr-4 py-3 rounded-xl border border-background-200 bg-white text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                    aria-label={t('password')}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 bg-accent-500 hover:bg-accent-600 active:scale-[0.98] text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                aria-label={t('login')}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" aria-hidden="true" />
                    {t('loading')}
                  </span>
                ) : (
                  t('login')
                )}
              </button>
            </form>

            <p className="text-center mt-5 text-sm text-foreground-500">
              {t('no_account')}{' '}
              <Link
                to="/auth/register"
                className="text-primary-600 hover:text-primary-700 font-semibold transition-colors"
              >
                {t('register_here')}
              </Link>
            </p>
          </div>

          {/* Bottom */}
          <p className="text-center text-foreground-400 text-xs mt-6">
            Демо версия — регистрирайте се за тест
          </p>
        </div>
      </main>
    </div>
  );
}