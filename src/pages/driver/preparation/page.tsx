import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { completeDriverPreparation, driverPreparationOptions, preparationKey } from '@/lib/driverPreparation';
import { verificationKey } from '@/lib/driverVerification';
import DriverPreparationForm from '@/components/feature/DriverPreparationForm';

export default function DriverPreparation() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const query = useQuery(driverPreparationOptions(user?.id));
  return <div className="min-h-screen bg-background-50">
    <header className="sticky top-0 z-50 bg-white px-4 py-3 flex items-center gap-3">
      <button type="button" aria-label="Назад към профила" onClick={() => navigate('/driver/profile')} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-background-100"><i className="ri-arrow-left-line text-lg" aria-hidden="true" /></button>
      <h1 className="font-heading text-lg font-bold text-foreground-950">Подготовка за шофьори</h1>
    </header>
    <main className="mx-auto max-w-2xl p-4 pb-8">
      {query.isPending ? <p role="status">Зареждаме условията и обучението…</p> : query.isError || !query.data ? <div role="alert" className="space-y-3 text-sm">
        <p>Не успяхме да заредим актуалната подготовка. Приемането не е потвърдено.</p>
        <button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} className="underline text-primary-700">Опитай отново</button>
      </div> : user && <DriverPreparationForm key={user.id + ':' + query.data.content_hash} materials={query.data}
        next={<Link to="/driver/profile" className="text-sm underline text-primary-700">Към профила и документите</Link>}
        onUncertain={() => { void query.refetch(); }} acceptPreparation={async answers => {
          const materials = query.data!;
          const result = await completeDriverPreparation(materials, answers, user.id);
          client.setQueryData(preparationKey(user.id), { ...materials, receipt: result.receipt });
          client.setQueryData(result.legalKey, { id: result.generalAcceptanceId });
          void client.invalidateQueries({ queryKey: verificationKey(materials.driver_id) });
        }} />}
    </main>
  </div>;
}
