import { consumeAuthReturn } from '@/lib/authReturn';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { socialAuthErrorKey } from '@/lib/socialAuth';
import { finishLegalIntent } from '@/lib/legalAcceptance';
import { withRequestTimeout } from '@/lib/requestTimeout';

export default function AuthCallback() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [errorKey, setErrorKey] = useState('');
  const [attempt, setAttempt] = useState(0);
  const startedRef = useRef<number | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (startedRef.current === attempt) return;
    startedRef.current = attempt;
    setErrorKey('');

    const finishLogin = async (owner: string) => {
      for (let retry = 0; ; retry++) {
        if (!mounted.current) return;
        try { await finishLegalIntent(); break; }
        catch (error) {
          // Staff OAuth starts at aal1. Legal acceptance remains required after MFA.
          const failure = error as { code?: string; message?: string; status?: number; name?: string } | null;
          if (failure?.code === '42501' && failure.message?.startsWith('MFA_REQUIRED:')) break;
          const transient = failure?.status === 0 || failure?.status === 401 || (failure?.status ?? 0) >= 500
            || ['TypeError', 'TimeoutError', 'AbortError'].includes(failure?.name ?? '');
          if (!transient || retry >= 2) throw error;
          // This RPC is idempotent. Retry only login completion, never the
          // one-use OAuth code, and never carry acceptance into another account.
          await new Promise(resolve => setTimeout(resolve, retry === 0 ? 400 : 1200));
          if (!mounted.current) return;
          const current = await withRequestTimeout(() => supabase.auth.getSession());
          if (current.error || current.data.session?.user.id !== owner) throw error;
        }
      }
      if (mounted.current) navigate(consumeAuthReturn(), { replace: true });
    };
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
          const { data, error } = await withRequestTimeout(() => supabase.auth.exchangeCodeForSession(code), 20_000);
          if (!mounted.current) return;
          if (error) { setErrorKey(socialAuthErrorKey(error)); return; }
          const redirectType = (data as { redirectType?: string } | null)?.redirectType;
          if (redirectType === 'recovery') {
            navigate('/auth/login', { replace: true });
            return;
          }
          if (!data.session) { setErrorKey('auth_callback_missing'); return; }
          await finishLogin(data.session.user.id);
          return;
        }

        const { data, error } = await withRequestTimeout(() => supabase.auth.getSession());
        if (!mounted.current) return;
        if (error) { setErrorKey(socialAuthErrorKey(error)); return; }
        if (data.session) { await finishLogin(data.session.user.id); return; }
        setErrorKey('auth_callback_missing');
      } catch (error) {
        if (mounted.current) setErrorKey(socialAuthErrorKey(error));
      }
    };

    void run();
  }, [navigate, attempt]);

  return <main className="brand-scope min-h-[100dvh] flex items-center justify-center p-6 bg-background-50">
    <div className="max-w-sm text-center">
      {errorKey ? <>
        <p role="alert" className="mb-4 text-foreground-800">{t(errorKey)}</p>
        <button type="button" className="mb-4 min-h-11 rounded-xl bg-primary-500 px-5 py-3 text-white" onClick={() => setAttempt(value => value + 1)}>{t('auth_callback_retry')}</button>
        <br />
        <Link className="underline text-primary-700" to="/auth/login">{t('auth_callback_back')}</Link>
      </> : <div role="status" className="flex flex-col items-center gap-3">
        <div className="size-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
        <span className="text-sm text-foreground-500">{t('auth_callback_working')}</span>
      </div>}
    </div>
  </main>;
}
