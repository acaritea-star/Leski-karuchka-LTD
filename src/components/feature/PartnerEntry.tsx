import { lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useSignOut } from '@/hooks/useSignOut';
import { invitationId } from '@/lib/authReturn';
import { resolvePartnerAccess, type PartnerAccess, type PartnerKind } from '@/lib/partnerAccess';
import { workflowError } from '@/lib/driverDocuments';
const InvitedDriverPreparation = lazy(() => import('./InvitedDriverPreparation'));
const OpenDriverApplications = lazy(() => import('./OpenDriverApplications'));

export default function PartnerEntry({ kind }: { kind: PartnerKind | 'any' }) {
  const { user, loading, refreshProfile } = useAuth();
  const { logout, pending, error: logoutError } = useSignOut();
  const location = useLocation(), navigate = useNavigate();
  const queryClient = useQueryClient();
  const invite = invitationId(location.search);
  const [redirectError, setRedirectError] = useState('');
  const [chosen, setChosen] = useState<{ owner: string; access: PartnerAccess } | null>(null);
  const latch = useRef(false);
  const query = useQuery({ queryKey: ['partner-entry', user?.id, kind, invite, user?.role, user?.company_id], enabled: !!user && !loading,
    staleTime: 30_000, retry: 1, refetchOnWindowFocus: false,
    queryFn: ({ signal }) => resolvePartnerAccess(kind, invite, signal),
  });
  const selecting = kind === 'driver' && !invite && query.data?.status === 'denied' && query.data.reason === 'invitation_required' && chosen?.owner === user?.id;
  const access = selecting ? chosen?.access ?? query.data : query.data;
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
  if (kind === 'driver' && access?.status === 'preparation' && user && access.role === user.role) return <InvitedDriverPreparation key={user.id + ':' + access.company_id} access={access} onRefresh={() => query.refetch()} onChooseCompany={selecting ? () => { setChosen(null); void queryClient.invalidateQueries({ queryKey: ['open-driver-companies'] }); } : undefined} />;
  const problem = query.isError ? workflowError(query.error, 'Връзката се забави. Поканата е запазена — опитай отново.') : redirectError || (access?.status === 'denied' ? access.message : '');
  const openCandidacy = kind === 'driver' && !invite && user && access?.status === 'denied' && access.reason === 'invitation_required';
  return <main className="brand-scope min-h-[100dvh] bg-background-50 flex items-center justify-center p-6"><div className="max-w-sm text-center space-y-4">
    <h1 className="text-xl font-heading font-semibold">{openCandidacy ? 'Започни като шофьор' : kind === 'company' ? 'Фирмен достъп' : kind === 'driver' ? 'Шофьорски достъп' : 'Твоята каручка'}</h1>
    {problem ? <>
      {openCandidacy ? <OpenDriverApplications key={user.id} onChoose={value => setChosen({ owner: user.id, access: value })} /> : <p role="alert" className="text-sm text-foreground-600">{problem}</p>}
      {invite && access?.status === 'denied' && access.reason === 'invitation_required' && <p className="text-sm text-foreground-600">Провери дали имейлът по-долу съвпада буква по буква с адреса в поканата. Ако има печатна грешка, фирмата трябва да изпрати нова покана с правилния адрес.</p>}
      <p className="text-xs text-foreground-500 break-all">{user?.email}</p>
      <button onClick={() => { latch.current = false; setRedirectError(''); void query.refetch(); }} className="text-primary-700 underline min-h-11">{openCandidacy ? 'Имаш лична покана? Провери' : 'Провери отново'}</button>
      <button onClick={logout} disabled={pending} className={openCandidacy ? 'block w-full min-h-11 text-sm underline disabled:opacity-60' : 'block w-full rounded-xl bg-primary-500 text-white px-4 py-3 disabled:opacity-60'}>{pending ? 'Излизане…' : 'Влез с друг акаунт'}</button>
      <Link to="/contact" className="block underline">Свържи се с нас</Link><Link to="/app" className="block text-xs underline">Към твоя профил</Link>
    </> : <p role="status">Проверяваме достъпа…</p>}
    {logoutError && <p role="alert">{logoutError}</p>}
  </div></main>;
}
