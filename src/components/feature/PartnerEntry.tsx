import { lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { invitationId } from '@/lib/authReturn';
import { resolvePartnerAccess, type PartnerKind } from '@/lib/partnerAccess';
import { workflowError } from '@/lib/driverDocuments';
const InvitedDriverPreparation = lazy(() => import('./InvitedDriverPreparation'));

export default function PartnerEntry({ kind }: { kind: PartnerKind | 'any' }) {
  const { user, loading, refreshProfile } = useAuth();
  const { logout, pending, error: logoutError } = useSignOut();
  const location = useLocation(), navigate = useNavigate();
  const invite = invitationId(location.search);
  const [redirectError, setRedirectError] = useState('');
  const latch = useRef(false);
  const query = useQuery({ queryKey: ['partner-entry', user?.id, kind, invite, user?.role, user?.company_id], enabled: !!user && !loading,
    staleTime: 30_000, retry: 1, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => resolvePartnerAccess(kind, invite, signal),
  });
  const access = query.data;
  useEffect(() => {
    if (!access || access.status === 'denied' || !user || latch.current) return;
    if (kind === 'driver' && access.status === 'preparation' && access.role === user.role) return;
    latch.current = true;
    let cancelled = false;
    void (async () => {
      try {
        if (access.role !== user.role || (access.company_id && access.company_id !== user.company_id && access.role === 'COMPANY_ADMIN')) await refreshProfile();
        if (!cancelled && !(kind === 'driver' && access.status === 'preparation')) navigate(access.destination!, { replace: true });
      } catch (e) { if (!cancelled) { latch.current = false; setRedirectError(workflowError(e, 'Обнови профила, за да продължиш.')); } }
    })();
    return () => { cancelled = true; latch.current = false; };
  }, [access, user, kind, navigate, refreshProfile]);
  if (kind === 'driver' && access?.status === 'preparation' && user && access.role === user.role) return <InvitedDriverPreparation key={user.id + ':' + access.company_id} access={access} onRefresh={() => query.refetch()} />;
  const problem = query.isError ? workflowError(query.error, 'Връзката се забави. Поканата е запазена — опитай отново.') : redirectError || (access?.status === 'denied' ? access.message : '');
  return <main className="brand-scope min-h-[100dvh] bg-background-50 flex items-center justify-center p-6"><div className="max-w-sm text-center space-y-4">
    <h1 className="text-xl font-heading font-semibold">{kind === 'company' ? 'Фирмен достъп' : kind === 'driver' ? 'Шофьорски достъп' : 'Твоята каручка'}</h1>
    {problem ? <>
      <p role="alert" className="text-sm text-foreground-600">{problem}</p><p className="text-sm break-all">{user?.email}</p>
      <button onClick={() => { latch.current = false; setRedirectError(''); void query.refetch(); }} className="text-primary-700 underline">Провери отново</button>
      <button onClick={logout} disabled={pending} className="block w-full rounded-xl bg-primary-500 text-white px-4 py-3 disabled:opacity-60">{pending ? 'Излизане…' : 'Влез с друг акаунт'}</button>
      <Link to="/contact" className="block underline">Свържи се с нас</Link><Link to="/app" className="block text-xs underline">Към твоя профил</Link>
    </> : <p role="status">Проверяваме достъпа…</p>}
    {logoutError && <p role="alert">{logoutError}</p>}
  </div></main>;
}
