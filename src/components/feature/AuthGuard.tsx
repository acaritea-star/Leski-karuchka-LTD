import PageLoading from './LoadingState';
import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import type { AppUser } from '@/hooks/useAuth';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import LegalAcceptanceNotice from './LegalAcceptanceNotice';
import { EmergencyDock } from './EmergencyHelp';
import { roleHomePath } from '@/lib/roleHome';

interface AuthGuardProps {
  children: React.ReactNode;
  allowedRoles?: AppUser['role'][];
  redirectTo?: string;
  showLegalNotice?: boolean;
  companyScoped?: boolean;
}

export default function AuthGuard({ children, allowedRoles, redirectTo = '/', showLegalNotice = true, companyScoped = true }: AuthGuardProps) {
  const { user, loading, session, refreshProfile, profileError } = useAuth();
  const { companyId, companies, loading: companyLoading } = useAdminCompany();
  const preparingCompany = companyScoped && (user?.role === 'SUPER_ADMIN' || user?.role === 'COMPANY_ADMIN') && companyLoading;
  const headquartersHasDivisions = companies.some(c => c.id === companyId && c.parent_company_id === null) && companies.some(c => c.parent_company_id === companyId);
  const needsCompanySetup = companyScoped && user?.role === 'COMPANY_ADMIN' && (!user.company_id || companies.some(c => c.id === companyId && c.setup_completed_at === null));
  const [retrying, setRetrying] = useState(false);
  const navigate = useNavigate();

  const rolesKey = allowedRoles ? allowedRoles.join(',') : '';
  const emergency = allowedRoles?.includes('CUSTOMER') ? <EmergencyDock /> : null;

  useEffect(() => {
    if (loading || preparingCompany) return;
    // An authenticated session with an unavailable profile gets a recovery screen.
    if (!user && (session || profileError)) return;
    if (!user) {
      navigate(redirectTo, { replace: true });
      return;
    }
    if (needsCompanySetup) { navigate(headquartersHasDivisions ? '/admin/divisions' : companyId ? '/company/setup?company=' + encodeURIComponent(companyId) : user.company_id ? '/company/setup' : '/company', { replace: true }); return; }
    if (rolesKey && !allowedRoles?.includes(user.role)) {
      navigate(roleHomePath(user.role), { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, preparingCompany, user, session, profileError, navigate, redirectTo, rolesKey, needsCompanySetup, companyId, headquartersHasDivisions]);

  if (loading) return <>{emergency}<PageLoading label="Отваряме профила ти…" /></>;

  if (preparingCompany) return <PageLoading title="Фирмен панел" label="Подготвяме фирмения панел…" />;

  if (!user && (session || profileError)) {
    const onRetry = async () => {
      setRetrying(true);
      try {
        await refreshProfile();
      } finally {
        setRetrying(false);
      }
    };
    return <>{emergency}{(
      <main className="min-h-screen flex items-center justify-center p-6">
        <div role="alert" className="max-w-sm text-center space-y-4">
          <p>Профилът не е достъпен в момента. Опитай отново или се свържи с поддръжката.</p>
          {profileError && (
            <p className="text-xs text-foreground-400 break-words">{profileError}</p>
          )}
          <button
            onClick={onRetry}
            disabled={retrying}
            className="rounded-xl bg-primary-500 text-white px-5 py-3 whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            {retrying ? 'Зареждане…' : 'Опитай отново'}
          </button>
          <a href="/auth/login" className="block underline">Към входа</a>
        </div>
      </main>
    )}</>;
  }

  if (!user || needsCompanySetup || (rolesKey && !allowedRoles?.includes(user.role))) {
    return null;
  }

  const scope = companyScoped && (user.role === 'SUPER_ADMIN' || user.role === 'COMPANY_ADMIN') ? companyId : '';
  // Discard forms, dialogs and late component reads when account/company changes.
  return <Fragment key={`${user.id}:${user.role}:${scope}`}>{showLegalNotice && <LegalAcceptanceNotice />}{children}</Fragment>;
}
