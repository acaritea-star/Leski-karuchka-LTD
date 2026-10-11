import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import PartnerEntry from '@/components/feature/PartnerEntry';

export default function AppRedirect() {
  const { user, loading, session, refreshProfile, profileError } = useAuth();
  const [retrying, setRetrying] = useState(false);

  const onRetry = async () => {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  };

  if (user && !loading) return <PartnerEntry kind="any" />;
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        {loading || user ? <p role="status">Подготвяме твоята каручка…</p> : <>
          <p role="alert">
            {session || profileError
              ? 'Профилът не е достъпен в момента. Опитай отново или се свържи с поддръжката.'
              : 'Влез в акаунта си, за да продължиш.'}
          </p>
          {profileError && (
            <p className="text-xs text-foreground-400 break-words">{profileError}</p>
          )}
          {(session || profileError) && (
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
