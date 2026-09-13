import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

export default function AppRedirect() {
  const {user, loading, session} = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (loading || !user) return;
    const home = user.role === 'DRIVER' ? '/driver/home'
      : user.role === 'CUSTOMER' ? '/customer/home' : '/admin/dashboard';
    navigate(home, {replace: true});
  }, [loading, user, navigate]);

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-4">
        {loading || user ? <p role="status">Подготвяме твоята каручка…</p> : <>
          <p role="alert">{session ? 'Профилът не е достъпен в момента. Опитай отново или се свържи с поддръжката.' : 'Влез в акаунта си, за да продължиш.'}</p>
          {session && <button onClick={() => window.location.reload()} className="rounded-xl bg-primary-500 text-white px-5 py-3">Опитай отново</button>}
          <Link to="/auth/login" className="block underline">Към входа</Link>
        </>}
      </div>
    </main>
  );
}
