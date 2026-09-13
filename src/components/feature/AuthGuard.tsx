import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/hooks/useAuth';

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: AppUser['role'][];
  redirectTo?: string;
}

function roleHome(user: AppUser | null): string {
  if (!user) return '/';
  if (user.role === 'DRIVER') return '/driver/home';
  if (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN') return '/admin/dashboard';
  return '/customer/home';
}

export default function AuthGuard({ children, allowedRoles, redirectTo = '/' }: AuthGuardProps) {
  const { user, loading, session } = useAuth();
  const navigate = useNavigate();

  const rolesKey = allowedRoles ? allowedRoles.join(',') : '';

  useEffect(() => {
    if (loading) return;
    // An authenticated session with an unavailable profile gets a recovery screen.
    if (!user && session) return;
    if (!user) {
      navigate(redirectTo, { replace: true });
      return;
    }
    if (rolesKey && !allowedRoles?.includes(user.role)) {
      navigate(roleHome(user), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user, session, navigate, redirectTo, rolesKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-foreground-500">Зареждане...</span>
        </div>
      </div>
    );
  }

  if (!user && session) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div role="alert" className="max-w-sm text-center space-y-4">
          <p>Профилът не е достъпен в момента. Опитай отново или се свържи с поддръжката.</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-primary-500 text-white px-5 py-3">Опитай отново</button>
          <a href="/auth/login" className="block underline">Към входа</a>
        </div>
      </main>
    );
  }

  if (!user || (rolesKey && !allowedRoles?.includes(user.role))) {
    return null;
  }

  return <>{children}</>;
}
