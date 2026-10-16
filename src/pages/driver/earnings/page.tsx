import { driverRecordOptions } from '@/lib/driverRecord';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AccountingPanel from '@/components/accounting/AccountingPanel';
export default function DriverEarnings() {
 const { t } = useTranslation();
 const { user } = useAuth();
 const navigate = useNavigate();
 const driverQuery = useQuery(driverRecordOptions(user?.id));
 return <div className="min-h-screen bg-background-50">
  <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
   <button type="button" onClick={() => navigate('/driver/home')} className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl text-foreground-600 hover:bg-background-100" aria-label="Назад"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M5 12h14" /></svg></button>
   <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_earnings')}</h1>
  </header>
  <div className="p-4">{driverQuery.data ? <AccountingPanel key={driverQuery.data.id} driverId={driverQuery.data.id} /> : driverQuery.isError ? <p role="alert" className="text-sm text-red-600">Профилът не се зареди. <button onClick={() => void driverQuery.refetch()} className="underline">Опитайте отново</button></p> : <p className="text-sm text-foreground-500">{driverQuery.isPending ? 'Зареждане…' : 'Все още няма шофьорски профил.'}</p>}</div>
 </div>;
}
