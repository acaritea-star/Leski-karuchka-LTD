import { useAuth } from '@/hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import AccountingPanel from '@/components/accounting/AccountingPanel';
export default function DriverEarnings() {
 const { t } = useTranslation();
 const { user } = useAuth();
 const navigate = useNavigate();
 const driverQuery = useQuery({
  queryKey: user?.id ? queryKeys.driverRecord(user.id) : ['drivers', 'me', 'none'],
  queryFn: async () => {
   const { data, error } = await supabase.from('drivers').select('*').eq('user_id', user!.id).maybeSingle();
   if (error) throw error;
   return data;
  }, enabled: !!user?.id,
 });
 return <div className="min-h-screen bg-background-50">
  <header className="bg-white px-4 py-3 flex items-center gap-3 sticky top-0 z-50">
   <button onClick={() => navigate('/driver/home')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100 transition-colors cursor-pointer" aria-label="Назад"><i className="ri-arrow-left-line text-foreground-600 text-lg" /></button>
   <h1 className="text-lg font-bold text-foreground-950 font-heading">{t('nav_earnings')}</h1>
  </header>
  <div className="p-4">{driverQuery.data ? <AccountingPanel key={driverQuery.data.id} driverId={driverQuery.data.id} /> : driverQuery.isError ? <p role="alert" className="text-sm text-red-600">Профилът не се зареди. <button onClick={() => void driverQuery.refetch()} className="underline">Опитайте отново</button></p> : <p className="text-sm text-foreground-500">{driverQuery.isPending ? 'Зареждане…' : 'Все още няма шофьорски профил.'}</p>}</div>
 </div>;
}
