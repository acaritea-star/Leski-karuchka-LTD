import PartnerEntry from '@/components/feature/PartnerEntry';
import AuthGuard from '@/components/feature/AuthGuard';
import { useLocation } from 'react-router-dom';
import { invitationId } from '@/lib/authReturn';
import { invitationLoginPath } from '@/lib/partnerAccess';
export default function DriverAccess() {
  const location = useLocation();
  return <AuthGuard companyScoped={false} redirectTo={invitationLoginPath('driver', invitationId(location.search))}><PartnerEntry kind="driver" /></AuthGuard>;
}
