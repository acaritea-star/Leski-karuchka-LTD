import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function AppRedirect() {
  const { user, loading, session, refreshProfile, profileError } = useAuth();
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (loading || !user) return;
    const home = user.role === 'DRIVER' ? '/driver/home'
      : user.role === 'CUSTOMER' ? '/customer/home' : '/admin/dashboard';
    navigate(home, {replace: true});
  }, [loading, user, navigate]);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        {loading || user ? <p role="status">Подготвяме твоята каручка…</p> : <>
          <p role="alert">
            {session
              ? 'Профилът не е достъпен в момента. Опитай отново или се свържи с поддръжката.'
              : 'Влез в акаунта си, за да продължиш.'}
          </p>
          {session && profileError && (
            <p className="text-xs text-foreground-400 break-words">Техническа причина: {profileError}</p>
          )}
          {session && (
            <button
              onClick={onRetry}
              disabled={retrying}
              className="rounded-xl bg-primary-500 text-white px-5 py-3 whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              {retrying ? 'Зареждане…' : 'Опитай отново'}
            </button>
          )}
          <Link to="/auth/login" className="block underline">Към входа</Link>
        </>}
      </div>
    </main>
  );
}
