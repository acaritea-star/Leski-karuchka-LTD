import PartnerEntry from '@/components/feature/PartnerEntry';
import AuthGuard from '@/components/feature/AuthGuard';
import { useLocation } from 'react-router-dom';
import { invitationId } from '@/lib/authReturn';
import { invitationLoginPath } from '@/lib/partnerAccess';
export default function CompanyEntry() {
  const location = useLocation();
  return <AuthGuard companyScoped={false} redirectTo={invitationLoginPath('company', invitationId(location.search))}><PartnerEntry kind="company" /></AuthGuard>;
}
