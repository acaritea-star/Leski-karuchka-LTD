import { useTranslation } from 'react-i18next';
import AdminLayout from '@/pages/admin/components/AdminLayout';
import { useAdminCompany } from '@/pages/admin/components/AdminCompanyContext';
import AccountingPanel from '@/components/accounting/AccountingPanel';
export default function AdminAnalytics() {
 const { t } = useTranslation();
 const { companyId, loading } = useAdminCompany();
 return <AdminLayout title={t('nav_analytics')}>
  {companyId ? <AccountingPanel key={companyId} companyId={companyId} /> : <p className="text-sm text-foreground-500">{loading ? 'Зареждане…' : 'Изберете фирма, за да видите отчета.'}</p>}
 </AdminLayout>;
}
