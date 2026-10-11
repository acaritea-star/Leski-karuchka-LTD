import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { roleHomePath } from '@/lib/roleHome';

export default function CompanyEntry() {
  const { user } = useAuth();
  const { logout, pending, error } = useSignOut();
  if (!user) return null; // AuthGuard handles session/profile recovery.
  if (user.role === 'SUPER_ADMIN' || (user.role === 'COMPANY_ADMIN' && user.company_id)) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }
  return <main className="brand-scope min-h-[100dvh] bg-background-50 flex items-center justify-center p-6">
    <div className="max-w-sm text-center space-y-4">
      <h1 className="text-xl font-semibold text-foreground-950 font-heading">Фирмен достъп</h1>
      <p className="text-sm text-foreground-600">За този профил още няма предоставен достъп до фирма. Свържи се с администратора на Лески Каручка и посочи профила, с който си влязъл.</p>
      <p className="text-sm text-foreground-800 break-all">{user.email}</p>
      {user.role !== 'COMPANY_ADMIN' && <Link to={roleHomePath(user.role)} className="block text-primary-600 underline">Към моя профил</Link>}
      <Link to="/contact" className="block text-primary-600 underline">Свържи се с нас</Link>
      <button onClick={logout} disabled={pending} className="rounded-xl bg-primary-500 text-white px-5 py-3 disabled:opacity-60">{pending ? 'Излизане…' : 'Излез и използвай друг профил'}</button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  </main>;
}
