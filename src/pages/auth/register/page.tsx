import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { LOGO_URL } from '@/lib/logo';

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { signUp, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: signUpError } = await signUp(email, password, {
        first_name: firstName,
        last_name: lastName,
        phone,
      });

      if (signUpError) {
        const msg = signUpError.message || '';
        const code = signUpError.status ? String(signUpError.status) : '';

        if (msg.includes('rate limit') || code === '429' || msg.includes('over_email_send_rate_limit')) {
          setError('Твърде много опити. Моля, изчакайте няколко минути и опитайте отново.');
        } else if (msg === 'User already registered' || msg.includes('already registered')) {
          setError('Вече има регистриран акаунт с този имейл. Моля, влезте.');
        } else if (msg.includes('email') && msg.includes('valid')) {
          setError('Невалиден имейл адрес. Моля, проверете го.');
        } else if (msg.includes('password') && (msg.includes('weak') || msg.includes('short'))) {
          setError('Паролата е твърде слаба. Минимум 6 символа.');
        } else {
          setError(msg);
        }
        setLoading(false);
        return;
      }

      // If session is returned (email confirm off), go to app
      if (data?.session) {
        navigate('/app', { replace: true });
        return;
      }

      // Otherwise show success message
      setError('');
      setEmail('');
      setPassword('');
      setFirstName('');
      setLastName('');
      setPhone('');
    } catch {
      setError('Възникна неочаквана грешка. Моля, опитайте отново.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    const { error: oauthError } = await signInWithOAuth('google');
    if (oauthError) {
      setError('Грешка при вход с Google. Моля, опитайте отново.');
      setLoading(false);
    }
  };

  return (
    <div className="brand-scope min-h-[100dvh] relative overflow-hidden flex items-center justify-center px-4 py-8">
      <div className="absolute inset-0 z-0">
        <img
          src="https://readdy.ai/api/search-image?query=Warm%20golden%20sunset%20over%20a%20small%20European%20town%20with%20cobblestone%20streets%2C%20amber%20and%20honey%20tones%2C%20cinematic%20atmosphere%2C%20minimal%20composition%2C%20no%20text&width=1200&height=900&seq=auth-register-kar&orientation=landscape&nocache=true"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      <Link
        to="/"
        className="absolute top-4 left-4 z-20 inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 text-white text-sm font-medium hover:bg-white/20 transition-colors whitespace-nowrap cursor-pointer"
      >
        <i className="ri-arrow-left-line text-sm" />
        {t('back_home')}
      </Link>

      <div className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src={LOGO_URL}
            alt="Лески Каручка"
            className="h-16 w-auto mx-auto mb-4 rounded-lg animate-taxi-bounce"
          />
          <h1 className="text-2xl font-bold text-white font-heading tracking-tight">
            {t('register')}
          </h1>
          <p className="text-white/70 text-sm mt-1">{t('register_cta')}</p>
        </div>

        <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-6 shadow-2xl shadow-black/20">
          {/* Google Sign Up */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full py-3 flex items-center justify-center gap-3 bg-white border border-background-200 rounded-xl text-sm font-medium text-foreground-700 hover:bg-background-50 transition-all disabled:opacity-50 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
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
            Регистрация с Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-background-200" />
            <span className="text-xs text-foreground-400">или с имейл</span>
            <div className="flex-1 h-px bg-background-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="flex items-center gap-2 bg-red-50 text-red-600 px-3 py-2.5 rounded-lg text-xs">
                <i className="ri-error-warning-line text-sm" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                  {t('first_name')}
                </label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="w-full px-3 py-3 rounded-xl border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                  {t('last_name')}
                </label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  className="w-full px-3 py-3 rounded-xl border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                {t('email')}
              </label>
              <div className="relative">
                <i className="ri-mail-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="your@email.com"
                  className="w-full pl-9 pr-4 py-3 rounded-xl border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                {t('phone')}
              </label>
              <div className="relative">
                <i className="ri-phone-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="+359 888 123 456"
                  className="w-full pl-9 pr-4 py-3 rounded-xl border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground-700 mb-1.5 uppercase tracking-wider">
                {t('password')}
              </label>
              <div className="relative">
                <i className="ri-lock-line absolute left-3 top-1/2 -translate-y-1/2 text-foreground-400 text-sm" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-4 py-3 rounded-xl border border-background-200 bg-background-50 text-foreground-950 text-sm focus:outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-400/15 transition-all"
                />
              </div>
            </div>

            <p className="text-xs text-foreground-500">
              С регистрацията приемам{' '}
              <Link to="/terms" className="text-primary-600 hover:text-primary-700 underline">
                Общите условия
              </Link>{' '}
              и{' '}
              <Link to="/privacy" className="text-primary-600 hover:text-primary-700 underline">
                Политиката за поверителност
              </Link>.
            </p>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-primary-500 hover:bg-primary-600 active:scale-[0.98] text-white font-semibold rounded-xl transition-all duration-200 disabled:opacity-50 whitespace-nowrap cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  {t('loading')}
                </span>
              ) : (
                t('register')
              )}
            </button>
          </form>

          <p className="text-center mt-5 text-sm text-foreground-500">
            {t('has_account')}{' '}
            <Link
              to="/auth/login"
              className="text-primary-600 hover:text-primary-700 font-semibold transition-colors"
            >
              {t('login_here')}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}