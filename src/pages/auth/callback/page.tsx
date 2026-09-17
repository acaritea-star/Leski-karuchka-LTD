import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const run = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const errorDescription = params.get('error_description') || params.get('error');
        if (errorDescription) {
          setError(errorDescription);
          return;
        }

        const code = params.get('code');
        if (code) {
          // Exchange the PKCE code exactly once and wait for the real result
          // before doing anything else — no timers, no optimistic navigation.
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            setError(exchangeError.message);
            return;
          }

          const redirectType = (data as { redirectType?: string } | null)?.redirectType;
          if (redirectType === 'recovery') {
            navigate('/auth/login', { replace: true });
            return;
          }

          setDone(true);
          navigate('/app', { replace: true });
          return;
        }

        // No code in the URL: an existing session (page refresh or email link
        // fallback) may already be stored — use it instead of dead-ending.
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session) {
          setDone(true);
          navigate('/app', { replace: true });
          return;
        }

        setError('Входът не е завършен. Опитай отново.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Възникна неочаквана грешка. Опитай отново.');
      }
    };

    void run();
  }, [navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-background-50">
      <div role="status" className="max-w-sm text-center">
        {error ? (
          <>
            <p className="mb-4">{error}</p>
            <a className="underline" href="/auth/login">Към входа</a>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <span className="text-sm text-foreground-500">
              {done ? 'Готово! Пренасочваме…' : 'Завършваме входа…'}
            </span>
          </div>
        )}
      </div>
    </main>
  );
}