import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { socialAuthErrorKey } from '@/lib/socialAuth';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [errorKey, setErrorKey] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      try {
        const query = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.slice(1));
        const providerError = query.get('error') || hash.get('error');
        const errorDescription = query.get('error_description') || hash.get('error_description');
        const code = query.get('code');
        // Keep codes and provider responses out of the address bar and later
        // referrers. An error takes precedence even if a code is also present.
        window.history.replaceState(window.history.state, '', window.location.pathname);
        if (providerError || errorDescription) {
          setErrorKey(socialAuthErrorKey({ code: providerError ?? '', message: errorDescription ?? '' }));
          return;
        }

        if (code) {
          // detectSessionInUrl remains false: this is the only code exchange.
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) { setErrorKey(socialAuthErrorKey(error)); return; }
          const redirectType = (data as { redirectType?: string } | null)?.redirectType;
          if (redirectType === 'recovery') {
            navigate('/auth/login', { replace: true });
            return;
          }
          if (!data.session) { setErrorKey('auth_callback_missing'); return; }
          navigate('/app', { replace: true });
          return;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) { setErrorKey(socialAuthErrorKey(error)); return; }
        if (data.session) { navigate('/app', { replace: true }); return; }
        setErrorKey('auth_callback_missing');
      } catch (error) {
        setErrorKey(socialAuthErrorKey(error));
      }
    };

    void run();
  }, [navigate]);

  return <main className="brand-scope min-h-[100dvh] flex items-center justify-center p-6 bg-background-50">
    <div className="max-w-sm text-center">
      {errorKey ? <>
        <p role="alert" className="mb-4 text-foreground-800">{t(errorKey)}</p>
        <Link className="underline text-primary-700" to="/auth/login">{t('auth_callback_back')}</Link>
      </> : <div role="status" className="flex flex-col items-center gap-3">
        <div className="size-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        <span className="text-sm text-foreground-500">{t('auth_callback_working')}</span>
      </div>}
    </div>
  </main>;
}
